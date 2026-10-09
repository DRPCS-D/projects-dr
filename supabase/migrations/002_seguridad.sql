-- Proyectos DR: seguridad (RLS), integridad de tareas y operaciones compuestas.
--
-- Regla central: un proyecto solo existe para sus miembros (tabla `miembros`).
-- La interfaz oculta lo que fallaria; lo que protege los datos es esto.
--
-- Convenciones (heredadas de app-base):
--  · Las funciones que evalua la RLS viven en el esquema `private`, que
--    PostgREST no expone: no se pueden llamar como RPC desde el navegador.
--  · Las tablas nuevas de `public` nacen con ALL para anon y authenticated:
--    primero se REVOCA todo y despues se concede solo lo necesario. Un grant
--    por columna sin el revoke previo no restringe nada.
--  · Las operaciones que tocan varias tablas a la vez (crear proyecto,
--    cambiar el equipo...) son funciones, no escrituras sueltas del cliente.

-- ═════════════════════════════════════════════════════════════════════════
-- Funciones de permisos (las usa la RLS)
-- ═════════════════════════════════════════════════════════════════════════

create or replace function private.usuario_activo()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u where u.id = (select auth.uid()) and u.activo
  )
$$;

create or replace function private.es_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.activo and u.rol = 'admin'
  )
$$;

create or replace function private.es_miembro(p_proyecto uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.miembros m
    join public.usuarios u on u.id = m.usuario_id
    where m.proyecto_id = p_proyecto and m.usuario_id = (select auth.uid()) and u.activo
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- Integridad de tareas (triggers)
-- ═════════════════════════════════════════════════════════════════════════

-- Valida y normaliza cada tarea antes de guardarla, para que no dependa de que
-- el cliente mande bien los datos.
create or replace function private.validar_tarea()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_padre public.tareas;
begin
  if tg_op = 'INSERT' then
    new.creado_por := (select auth.uid());
    new.creado_en := now();
    new.completada := false;
    new.completada_en := null;
  end if;
  new.actualizado_en := now();

  -- Subtarea: un solo nivel, mismo proyecto, y vive en la seccion de su principal.
  if new.parent_id is not null then
    select * into v_padre from public.tareas where id = new.parent_id;
    if not found or v_padre.proyecto_id <> new.proyecto_id then
      raise exception 'La tarea principal no es de este proyecto.' using errcode = '22023';
    end if;
    if v_padre.parent_id is not null then
      raise exception 'Las subtareas no pueden tener subtareas.' using errcode = '22023';
    end if;
    new.seccion_id := v_padre.seccion_id;
  end if;

  if not exists (
    select 1 from public.secciones s where s.id = new.seccion_id and s.proyecto_id = new.proyecto_id
  ) then
    raise exception 'La sección no pertenece al proyecto.' using errcode = '22023';
  end if;

  -- Solo se valida cuando CAMBIA: si alguien sale del proyecto, sus tareas
  -- viejas no deben volverse imposibles de editar.
  if new.responsable_id is not null
     and (tg_op = 'INSERT' or new.responsable_id is distinct from old.responsable_id)
     and not exists (
       select 1 from public.miembros m
       where m.proyecto_id = new.proyecto_id and m.usuario_id = new.responsable_id
     )
  then
    raise exception 'El responsable tiene que ser miembro del proyecto.' using errcode = '22023';
  end if;

  -- Solo etiquetas que existen en ESTE proyecto (y sin repetir).
  new.etiquetas := coalesce(
    (select array_agg(e.id) from public.etiquetas e
      where e.proyecto_id = new.proyecto_id and e.id = any (new.etiquetas)),
    '{}'
  );

  if tg_op = 'UPDATE' and new.completada is distinct from old.completada then
    new.completada_en := case when new.completada then now() else null end;
  end if;

  return new;
end;
$$;

create trigger tareas_validar
  before insert or update on public.tareas
  for each row execute function private.validar_tarea();

-- Mover una tarea principal a otra seccion arrastra sus subtareas.
create or replace function private.tarea_mover_subtareas()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tareas set seccion_id = new.seccion_id where parent_id = new.id;
  return null;
end;
$$;

create trigger tareas_mover_subtareas
  after update of seccion_id on public.tareas
  for each row
  when (old.seccion_id is distinct from new.seccion_id and new.parent_id is null)
  execute function private.tarea_mover_subtareas();

-- Al borrar una etiqueta se la saca de las tareas que la usaban.
create or replace function private.etiqueta_borrada()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tareas
     set etiquetas = array_remove(etiquetas, old.id)
   where proyecto_id = old.proyecto_id and old.id = any (etiquetas);
  return null;
end;
$$;

create trigger etiquetas_borrada
  after delete on public.etiquetas
  for each row execute function private.etiqueta_borrada();

-- Registro de actividad (el feed se muestra en una fase siguiente).
create or replace function private.actividad_tarea()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_seccion text;
begin
  if tg_op = 'INSERT' then
    insert into public.actividad (proyecto_id, usuario_id, accion, entidad, entidad_id, detalle)
    values (new.proyecto_id, (select auth.uid()), 'creo', 'tarea', new.id, new.titulo);
  elsif tg_op = 'UPDATE' then
    if new.completada is distinct from old.completada then
      insert into public.actividad (proyecto_id, usuario_id, accion, entidad, entidad_id, detalle)
      values (new.proyecto_id, (select auth.uid()),
              case when new.completada then 'completo' else 'reabrio' end, 'tarea', new.id, new.titulo);
    elsif new.seccion_id is distinct from old.seccion_id and new.parent_id is null then
      select nombre into v_seccion from public.secciones where id = new.seccion_id;
      insert into public.actividad (proyecto_id, usuario_id, accion, entidad, entidad_id, detalle)
      values (new.proyecto_id, (select auth.uid()), 'movio', 'tarea', new.id,
              new.titulo || ' → ' || coalesce(v_seccion, ''));
    end if;
  elsif tg_op = 'DELETE' then
    -- Al borrar un proyecto entero sus tareas se borran en cascada: el
    -- proyecto ya no existe y registrarlo violaria la clave foranea.
    if old.parent_id is null
       and exists (select 1 from public.proyectos p where p.id = old.proyecto_id) then
      insert into public.actividad (proyecto_id, usuario_id, accion, entidad, entidad_id, detalle)
      values (old.proyecto_id, (select auth.uid()), 'elimino', 'tarea', old.id, old.titulo);
    end if;
  end if;
  return null;
end;
$$;

create trigger tareas_actividad
  after insert or update or delete on public.tareas
  for each row execute function private.actividad_tarea();

-- ═════════════════════════════════════════════════════════════════════════
-- RLS y permisos por tabla
-- ═════════════════════════════════════════════════════════════════════════

alter table public.usuarios enable row level security;
alter table public.proyectos enable row level security;
alter table public.miembros enable row level security;
alter table public.secciones enable row level security;
alter table public.etiquetas enable row level security;
alter table public.tareas enable row level security;
alter table public.actividad enable row level security;

revoke all on public.usuarios, public.proyectos, public.miembros, public.secciones,
              public.etiquetas, public.tareas, public.actividad
  from anon, authenticated;

-- usuarios: todos los activos se ven entre si (hace falta para elegir miembros
-- y responsables); uno siempre ve su propia fila, incluso desactivado, para que
-- la app pueda explicarle por que no entra. Escribir solo lo hace la Edge
-- Function admin-usuarios (service_role), nunca el cliente.
create policy usuarios_select on public.usuarios
  for select to authenticated
  using (id = (select auth.uid()) or private.usuario_activo());
grant select on public.usuarios to authenticated;

-- proyectos: solo sus miembros. Se crean con crear_proyecto().
create policy proyectos_select on public.proyectos
  for select to authenticated using (private.es_miembro(id));
create policy proyectos_update on public.proyectos
  for update to authenticated
  using (private.es_miembro(id)) with check (private.es_miembro(id));
create policy proyectos_delete on public.proyectos
  for delete to authenticated using (private.es_miembro(id));
grant select, delete on public.proyectos to authenticated;
grant update (nombre, descripcion, color, estado, drive_folder_id) on public.proyectos to authenticated;

-- miembros: se ven entre los del proyecto; se cambian con guardar_miembros() / salir_proyecto().
create policy miembros_select on public.miembros
  for select to authenticated using (private.es_miembro(proyecto_id));
grant select on public.miembros to authenticated;

-- secciones y etiquetas: miembros del proyecto.
create policy secciones_select on public.secciones
  for select to authenticated using (private.es_miembro(proyecto_id));
create policy secciones_insert on public.secciones
  for insert to authenticated with check (private.es_miembro(proyecto_id));
create policy secciones_update on public.secciones
  for update to authenticated
  using (private.es_miembro(proyecto_id)) with check (private.es_miembro(proyecto_id));
create policy secciones_delete on public.secciones
  for delete to authenticated using (private.es_miembro(proyecto_id));
grant select, delete on public.secciones to authenticated;
grant insert (proyecto_id, nombre, orden) on public.secciones to authenticated;
grant update (nombre, orden) on public.secciones to authenticated;

create policy etiquetas_select on public.etiquetas
  for select to authenticated using (private.es_miembro(proyecto_id));
create policy etiquetas_insert on public.etiquetas
  for insert to authenticated with check (private.es_miembro(proyecto_id));
create policy etiquetas_update on public.etiquetas
  for update to authenticated
  using (private.es_miembro(proyecto_id)) with check (private.es_miembro(proyecto_id));
create policy etiquetas_delete on public.etiquetas
  for delete to authenticated using (private.es_miembro(proyecto_id));
grant select, delete on public.etiquetas to authenticated;
grant insert (proyecto_id, nombre, color) on public.etiquetas to authenticated;
grant update (nombre, color) on public.etiquetas to authenticated;

-- tareas: miembros del proyecto. proyecto_id, parent_id y quien la creo no
-- se pueden cambiar despues de creada (no estan en el grant de update).
create policy tareas_select on public.tareas
  for select to authenticated using (private.es_miembro(proyecto_id));
create policy tareas_insert on public.tareas
  for insert to authenticated with check (private.es_miembro(proyecto_id));
create policy tareas_update on public.tareas
  for update to authenticated
  using (private.es_miembro(proyecto_id)) with check (private.es_miembro(proyecto_id));
create policy tareas_delete on public.tareas
  for delete to authenticated using (private.es_miembro(proyecto_id));
grant select, delete on public.tareas to authenticated;
grant insert (proyecto_id, seccion_id, parent_id, titulo, descripcion, responsable_id,
              fecha_inicio, fecha_vencimiento, prioridad, etiquetas, orden)
  on public.tareas to authenticated;
grant update (seccion_id, titulo, descripcion, responsable_id, fecha_inicio, fecha_vencimiento,
              prioridad, etiquetas, completada, orden)
  on public.tareas to authenticated;

-- actividad: solo lectura para los miembros; la escriben los triggers.
create policy actividad_select on public.actividad
  for select to authenticated using (private.es_miembro(proyecto_id));
grant select on public.actividad to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- Operaciones compuestas (RPC)
-- ═════════════════════════════════════════════════════════════════════════

-- Crea el proyecto con su equipo y sus secciones iniciales, todo o nada.
-- security definer porque al crearlo todavia no es miembro (no podria
-- insertar su propia membresia bajo la RLS); lo protege el chequeo de abajo.
create or replace function public.crear_proyecto(
  p_nombre text,
  p_descripcion text default '',
  p_color text default '#1659b5',
  p_miembros uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := (select auth.uid());
begin
  if not private.usuario_activo() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nombre, ''))) = 0 then
    raise exception 'El nombre del proyecto es obligatorio.' using errcode = '22023';
  end if;

  insert into public.proyectos (nombre, descripcion, color, creado_por)
  values (trim(p_nombre), coalesce(p_descripcion, ''), coalesce(p_color, '#1659b5'), v_uid)
  returning id into v_id;

  -- Quien lo crea siempre queda adentro; el resto, solo si existe y esta activo.
  insert into public.miembros (proyecto_id, usuario_id)
  select v_id, u.id from public.usuarios u
  where u.activo and (u.id = v_uid or u.id = any (coalesce(p_miembros, '{}')));

  insert into public.secciones (proyecto_id, nombre, orden)
  values (v_id, 'Por hacer', 1), (v_id, 'En curso', 2), (v_id, 'Hecho', 3);

  insert into public.actividad (proyecto_id, usuario_id, accion, entidad, entidad_id, detalle)
  values (v_id, v_uid, 'creo', 'proyecto', v_id, trim(p_nombre));

  return v_id;
end;
$$;

-- Reemplaza el equipo. Quien lo cambia no puede sacarse a si mismo desde aca
-- (para eso esta salir_proyecto) y las tareas de quien sale quedan sin responsable.
create or replace function public.guardar_miembros(p_proyecto uuid, p_usuarios uuid[])
returns uuid[]
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
begin
  if not private.es_miembro(p_proyecto) then
    raise exception 'Proyecto no encontrado.' using errcode = 'P0002';
  end if;

  v_ids := array(
    select u.id from public.usuarios u
    where u.activo and (u.id = v_uid or u.id = any (coalesce(p_usuarios, '{}')))
  );

  delete from public.miembros where proyecto_id = p_proyecto and not (usuario_id = any (v_ids));
  update public.tareas set responsable_id = null
   where proyecto_id = p_proyecto and responsable_id is not null and not (responsable_id = any (v_ids));
  insert into public.miembros (proyecto_id, usuario_id)
  select p_proyecto, x from unnest(v_ids) as x
  on conflict do nothing;

  return v_ids;
end;
$$;

create or replace function public.salir_proyecto(p_proyecto uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not private.es_miembro(p_proyecto) then
    raise exception 'Proyecto no encontrado.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.miembros m join public.usuarios u on u.id = m.usuario_id
       where m.proyecto_id = p_proyecto and u.activo) <= 1 then
    raise exception 'Sos el único miembro: agregá a alguien más o eliminá el proyecto.' using errcode = '22023';
  end if;
  delete from public.miembros where proyecto_id = p_proyecto and usuario_id = v_uid;
  update public.tareas set responsable_id = null
   where proyecto_id = p_proyecto and responsable_id = v_uid;
end;
$$;

-- Borra una seccion. Si tiene tareas hay que decir a donde pasan. Corre con
-- los permisos de quien llama (security invoker): la RLS sigue mandando.
create or replace function public.eliminar_seccion(p_seccion uuid, p_mover_a uuid default null)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_s public.secciones;
  v_max double precision;
begin
  select * into v_s from public.secciones where id = p_seccion;
  if not found then
    raise exception 'Sección no encontrada.' using errcode = 'P0002';
  end if;
  if (select count(*) from public.secciones where proyecto_id = v_s.proyecto_id) <= 1 then
    raise exception 'Un proyecto necesita al menos una sección.' using errcode = '22023';
  end if;

  if exists (select 1 from public.tareas where seccion_id = p_seccion) then
    if p_mover_a is null or p_mover_a = p_seccion then
      raise exception 'Elegí a qué sección pasan sus tareas.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.secciones where id = p_mover_a and proyecto_id = v_s.proyecto_id) then
      raise exception 'La sección de destino no es de este proyecto.' using errcode = '22023';
    end if;
    select coalesce(max(orden), 0) into v_max
      from public.tareas where seccion_id = p_mover_a and parent_id is null;
    -- Las principales conservan su orden relativo, al final de la otra seccion;
    -- sus subtareas las arrastra el trigger.
    update public.tareas t
       set seccion_id = p_mover_a, orden = v_max + r.n
      from (select id, row_number() over (order by orden) as n
              from public.tareas where seccion_id = p_seccion and parent_id is null) r
     where t.id = r.id;
  end if;

  delete from public.secciones where id = p_seccion;
end;
$$;

-- Lista de proyectos con su resumen. `hoy` lo manda el cliente: "vencida"
-- depende de la zona horaria de quien mira, no de la del servidor.
-- security invoker: la RLS filtra y solo salen los proyectos del usuario.
create or replace function public.listar_proyectos(hoy date)
returns table (
  id uuid, nombre text, descripcion text, color text, estado text,
  drive_folder_id text, creado_por uuid, creado_en timestamptz,
  miembros uuid[], total integer, completadas integer, vencidas integer
)
language sql stable security invoker set search_path = ''
as $$
  select
    p.id, p.nombre, p.descripcion, p.color, p.estado, p.drive_folder_id, p.creado_por, p.creado_en,
    coalesce((select array_agg(m.usuario_id) from public.miembros m where m.proyecto_id = p.id), '{}'),
    (select count(*) from public.tareas t where t.proyecto_id = p.id and t.parent_id is null)::integer,
    (select count(*) from public.tareas t where t.proyecto_id = p.id and t.parent_id is null and t.completada)::integer,
    (select count(*) from public.tareas t
      where t.proyecto_id = p.id and t.parent_id is null and not t.completada
        and t.fecha_vencimiento < hoy)::integer
  from public.proyectos p
$$;

-- Las funciones de public se pueden llamar como RPC: solo usuarios con sesion.
revoke execute on function public.crear_proyecto(text, text, text, uuid[]) from public, anon;
revoke execute on function public.guardar_miembros(uuid, uuid[]) from public, anon;
revoke execute on function public.salir_proyecto(uuid) from public, anon;
revoke execute on function public.eliminar_seccion(uuid, uuid) from public, anon;
revoke execute on function public.listar_proyectos(date) from public, anon;
grant execute on function public.crear_proyecto(text, text, text, uuid[]) to authenticated;
grant execute on function public.guardar_miembros(uuid, uuid[]) to authenticated;
grant execute on function public.salir_proyecto(uuid) to authenticated;
grant execute on function public.eliminar_seccion(uuid, uuid) to authenticated;
grant execute on function public.listar_proyectos(date) to authenticated;
