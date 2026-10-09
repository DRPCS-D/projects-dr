-- Pruebas de seguridad (RLS) de Proyectos DR, contra Postgres de verdad.
--
-- Cada asercion se hace "pasando por" una persona concreta: se fijan los
-- mismos ajustes que usa PostgREST en produccion (request.jwt.claim.sub y el
-- rol de Postgres), no un mock aparte.
--
-- COMO CORRERLO: pegar TODO este archivo en el SQL Editor de Supabase (o
-- mandarlo con execute_sql). Termina SIEMPRE con un error "REPORTE ..." a
-- proposito: eso descarta la transaccion entera (datos de prueba y funciones
-- auxiliares incluidos) y el reporte viaja en el mensaje del error.
--   · "ok"     → la aserción pasó
--   · "FALLA"  → algo dejó de cumplirse: el nombre dice qué
--
-- Al agregar una tabla o una politica, sumar su caso aca. Ojo: un
-- UPDATE/DELETE bloqueado por `using` no tira error (afecta 0 filas), por eso
-- esos casos cuentan filas; uno bloqueado por `with check` o por permisos si
-- tira excepcion (42501), y esos se prueban con begin/exception.

create function public.zz_chk(p_nombre text, p_ok boolean) returns void
language plpgsql as $$
begin
  perform set_config('t.res',
    coalesce(current_setting('t.res', true), '') || case when p_ok then 'ok     ' else 'FALLA  ' end || p_nombre || E'\n',
    true);
end $$;

create function public.zz_como(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  ana   uuid := '00000000-0000-0000-0000-0000000000a1'; -- admin
  beto  uuid := '00000000-0000-0000-0000-0000000000b1'; -- usuario
  carla uuid := '00000000-0000-0000-0000-0000000000c1'; -- usuario
  dario uuid := '00000000-0000-0000-0000-0000000000d1'; -- usuario DESACTIVADO
  p1 uuid; p2 uuid;
  sec1 uuid; sec2 uuid; sec3 uuid; sec_otro uuid;
  t1 uuid; t2 uuid; sub uuid; et uuid; et_otro uuid; v_sec uuid;
  n int; b boolean; ids uuid[]; r record;
begin
  -- Datos de prueba, como postgres.
  insert into auth.users (id, email, aud, role) values
    (ana, 'ana@t.test', 'authenticated', 'authenticated'),
    (beto, 'beto@t.test', 'authenticated', 'authenticated'),
    (carla, 'carla@t.test', 'authenticated', 'authenticated'),
    (dario, 'dario@t.test', 'authenticated', 'authenticated');
  insert into public.usuarios (id, nombre, email, rol, activo) values
    (ana, 'Ana', 'ana@t.test', 'admin', true),
    (beto, 'Beto', 'beto@t.test', 'usuario', true),
    (carla, 'Carla', 'carla@t.test', 'usuario', true),
    (dario, 'Dario', 'dario@t.test', 'usuario', false);

  -- ── Crear proyecto ───────────────────────────────────────────────────────
  perform public.zz_como(beto);
  set local role authenticated;
  p1 := public.crear_proyecto('P Beto', '', '#111111', array[dario]);
  select count(*) into n from public.proyectos;
  perform public.zz_chk('beto ve su proyecto recien creado', n = 1);
  select count(*) into n from public.secciones where proyecto_id = p1;
  perform public.zz_chk('el proyecto nace con 3 secciones', n = 3);
  select count(*) into n from public.miembros where proyecto_id = p1;
  perform public.zz_chk('el equipo es solo beto (un usuario desactivado no entra)', n = 1);
  select id into sec1 from public.secciones where proyecto_id = p1 and nombre = 'Por hacer';
  select id into sec2 from public.secciones where proyecto_id = p1 and nombre = 'En curso';
  select id into sec3 from public.secciones where proyecto_id = p1 and nombre = 'Hecho';

  -- ── Aislamiento: quien no es miembro no ve ni toca nada ────────────────────
  perform public.zz_como(carla);
  select count(*) into n from public.proyectos;
  perform public.zz_chk('carla (no miembro) no ve proyectos', n = 0);
  select count(*) into n from public.secciones;
  perform public.zz_chk('carla no ve secciones ajenas', n = 0);
  select count(*) into n from public.miembros;
  perform public.zz_chk('carla no ve miembros ajenos', n = 0);
  select count(*) into n from public.actividad;
  perform public.zz_chk('carla no ve la actividad ajena', n = 0);

  update public.proyectos set nombre = 'hack' where id = p1;
  get diagnostics n = row_count;
  perform public.zz_chk('carla no puede editar un proyecto ajeno', n = 0);
  delete from public.proyectos where id = p1;
  get diagnostics n = row_count;
  perform public.zz_chk('carla no puede borrar un proyecto ajeno', n = 0);
  update public.secciones set nombre = 'hack' where id = sec1;
  get diagnostics n = row_count;
  perform public.zz_chk('carla no puede renombrar secciones ajenas', n = 0);

  begin
    insert into public.tareas (proyecto_id, seccion_id, titulo, orden) values (p1, sec1, 'x', 1);
    perform public.zz_chk('carla no puede crear tareas en un proyecto ajeno', false);
  exception when others then
    perform public.zz_chk('carla no puede crear tareas en un proyecto ajeno', sqlstate = '42501');
  end;
  begin
    insert into public.secciones (proyecto_id, nombre, orden) values (p1, 'x', 9);
    perform public.zz_chk('carla no puede crear secciones en un proyecto ajeno', false);
  exception when others then
    perform public.zz_chk('carla no puede crear secciones en un proyecto ajeno', sqlstate = '42501');
  end;
  begin
    perform public.guardar_miembros(p1, array[carla]);
    perform public.zz_chk('carla no puede meterse como miembro', false);
  exception when others then
    perform public.zz_chk('carla no puede meterse como miembro', sqlstate = 'P0002');
  end;
  begin
    insert into public.miembros (proyecto_id, usuario_id) values (p1, carla);
    perform public.zz_chk('insertar en miembros directo esta prohibido', false);
  exception when others then
    perform public.zz_chk('insertar en miembros directo esta prohibido', sqlstate = '42501');
  end;
  begin
    insert into public.proyectos (nombre) values ('x');
    perform public.zz_chk('insertar un proyecto directo esta prohibido (solo crear_proyecto)', false);
  exception when others then
    perform public.zz_chk('insertar un proyecto directo esta prohibido (solo crear_proyecto)', sqlstate = '42501');
  end;
  begin
    insert into public.usuarios (id, nombre, email) values (gen_random_uuid(), 'x', 'x@t.test');
    perform public.zz_chk('el cliente no puede escribir en usuarios', false);
  exception when others then
    perform public.zz_chk('el cliente no puede escribir en usuarios', sqlstate = '42501');
  end;
  begin
    update public.usuarios set rol = 'admin' where id = carla;
    get diagnostics n = row_count;
    perform public.zz_chk('nadie se puede ascender a admin desde el cliente', false);
  exception when others then
    perform public.zz_chk('nadie se puede ascender a admin desde el cliente', sqlstate = '42501');
  end;

  -- ── Roles: el admin gestiona usuarios, no ve proyectos ajenos ─────────────
  perform public.zz_como(ana);
  select count(*) into n from public.proyectos;
  perform public.zz_chk('el admin NO ve proyectos de los que no es miembro', n = 0);
  select count(*) into n from public.usuarios;
  perform public.zz_chk('un usuario activo ve a todos los usuarios (para elegir equipo)', n = 4);
  perform public.zz_chk('private.es_admin() es true para ana', private.es_admin());
  perform public.zz_como(beto);
  perform public.zz_chk('private.es_admin() es false para beto', not private.es_admin());

  -- ── Sin sesion (anon) ────────────────────────────────────────────────────
  set local role anon;
  begin
    perform count(*) from public.proyectos;
    perform public.zz_chk('anon no puede leer proyectos', false);
  exception when others then
    perform public.zz_chk('anon no puede leer proyectos', sqlstate = '42501');
  end;
  begin
    perform count(*) from public.usuarios;
    perform public.zz_chk('anon no puede leer usuarios', false);
  exception when others then
    perform public.zz_chk('anon no puede leer usuarios', sqlstate = '42501');
  end;
  begin
    perform public.crear_proyecto('x');
    perform public.zz_chk('anon no puede llamar a crear_proyecto', false);
  exception when others then
    perform public.zz_chk('anon no puede llamar a crear_proyecto', sqlstate = '42501');
  end;
  set local role authenticated;

  -- ── Usuario desactivado ──────────────────────────────────────────────────
  reset role;
  insert into public.miembros (proyecto_id, usuario_id) values (p1, dario);
  set local role authenticated;
  perform public.zz_como(dario);
  select count(*) into n from public.proyectos;
  perform public.zz_chk('un desactivado no ve proyectos aunque siga como miembro', n = 0);
  select count(*) into n from public.usuarios;
  perform public.zz_chk('un desactivado solo ve su propia fila', n = 1);
  begin
    perform public.crear_proyecto('x');
    perform public.zz_chk('un desactivado no puede crear proyectos', false);
  exception when others then
    perform public.zz_chk('un desactivado no puede crear proyectos', sqlstate = '42501');
  end;
  reset role;
  delete from public.miembros where proyecto_id = p1 and usuario_id = dario;
  set local role authenticated;

  -- ── Tareas ───────────────────────────────────────────────────────────────
  perform public.zz_como(beto);
  insert into public.tareas (proyecto_id, seccion_id, titulo, orden) values (p1, sec1, 'T1', 1) returning id into t1;
  select creado_por = beto into b from public.tareas where id = t1;
  perform public.zz_chk('creado_por lo fija el servidor', b);

  begin
    update public.tareas set responsable_id = ana where id = t1;
    perform public.zz_chk('el responsable tiene que ser miembro', false);
  exception when others then
    perform public.zz_chk('el responsable tiene que ser miembro', sqlstate = '22023');
  end;

  -- subtareas: toman la seccion de su principal, un solo nivel
  insert into public.tareas (proyecto_id, seccion_id, parent_id, titulo, orden) values (p1, sec2, t1, 'S1', 1) returning id into sub;
  select seccion_id into v_sec from public.tareas where id = sub;
  perform public.zz_chk('la subtarea toma la seccion de su principal (aunque el cliente mande otra)', v_sec = sec1);
  begin
    insert into public.tareas (proyecto_id, seccion_id, parent_id, titulo, orden) values (p1, sec1, sub, 'SS', 1);
    perform public.zz_chk('no hay subtareas de subtareas', false);
  exception when others then
    perform public.zz_chk('no hay subtareas de subtareas', sqlstate = '22023');
  end;
  update public.tareas set seccion_id = sec3 where id = t1;
  select seccion_id into v_sec from public.tareas where id = sub;
  perform public.zz_chk('mover la principal arrastra sus subtareas', v_sec = sec3);

  -- completar
  update public.tareas set completada = true where id = t1;
  select completada_en is not null into b from public.tareas where id = t1;
  perform public.zz_chk('completar fija completada_en', b);
  update public.tareas set completada = false where id = t1;
  select completada_en is null into b from public.tareas where id = t1;
  perform public.zz_chk('reabrir limpia completada_en', b);

  -- cruces entre proyectos
  perform public.zz_como(carla);
  p2 := public.crear_proyecto('P Carla');
  select id into sec_otro from public.secciones where proyecto_id = p2 limit 1;
  insert into public.etiquetas (proyecto_id, nombre) values (p2, 'Ajena') returning id into et_otro;
  perform public.zz_como(beto);
  begin
    update public.tareas set seccion_id = sec_otro where id = t1;
    perform public.zz_chk('no se puede usar una seccion de otro proyecto', false);
  exception when others then
    perform public.zz_chk('no se puede usar una seccion de otro proyecto', sqlstate in ('22023', '42501'));
  end;
  begin
    update public.tareas set proyecto_id = p2 where id = t1;
    perform public.zz_chk('una tarea no puede cambiar de proyecto', false);
  exception when others then
    perform public.zz_chk('una tarea no puede cambiar de proyecto', sqlstate = '42501');
  end;
  begin
    update public.tareas set creado_por = carla where id = t1;
    perform public.zz_chk('creado_por no se puede reescribir', false);
  exception when others then
    perform public.zz_chk('creado_por no se puede reescribir', sqlstate = '42501');
  end;

  -- etiquetas
  insert into public.etiquetas (proyecto_id, nombre) values (p1, 'Urg') returning id into et;
  update public.tareas set etiquetas = array[et, et_otro] where id = t1;
  select etiquetas into ids from public.tareas where id = t1;
  perform public.zz_chk('solo se aceptan etiquetas del propio proyecto', ids = array[et]);
  delete from public.etiquetas where id = et;
  select etiquetas into ids from public.tareas where id = t1;
  perform public.zz_chk('borrar una etiqueta la saca de las tareas', ids = '{}');

  -- eliminar secciones
  begin
    perform public.eliminar_seccion(sec3);
    perform public.zz_chk('una seccion con tareas exige elegir destino', false);
  exception when others then
    perform public.zz_chk('una seccion con tareas exige elegir destino', sqlstate = '22023');
  end;
  perform public.eliminar_seccion(sec3, sec1);
  select count(*) into n from public.secciones where proyecto_id = p1;
  perform public.zz_chk('la seccion se elimino', n = 2);
  select seccion_id into v_sec from public.tareas where id = t1;
  perform public.zz_chk('sus tareas pasaron a la seccion destino', v_sec = sec1);
  select seccion_id into v_sec from public.tareas where id = sub;
  perform public.zz_chk('y sus subtareas tambien', v_sec = sec1);
  perform public.eliminar_seccion(sec2);
  begin
    perform public.eliminar_seccion(sec1, null);
    perform public.zz_chk('no se puede dejar un proyecto sin secciones', false);
  exception when others then
    perform public.zz_chk('no se puede dejar un proyecto sin secciones', sqlstate = '22023');
  end;

  -- ── Equipo ───────────────────────────────────────────────────────────────
  ids := public.guardar_miembros(p1, array[carla, dario]);
  perform public.zz_chk('equipo: beto + carla (el desactivado se descarta)', array_length(ids, 1) = 2 and ids @> array[beto, carla]);
  perform public.zz_como(carla);
  select count(*) into n from public.proyectos where id = p1;
  perform public.zz_chk('carla ya ve el proyecto', n = 1);
  update public.tareas set responsable_id = carla where id = t1;
  select responsable_id = carla into b from public.tareas where id = t1;
  perform public.zz_chk('un miembro puede ser responsable', b);
  perform public.zz_como(beto);
  ids := public.guardar_miembros(p1, '{}');
  perform public.zz_chk('quien cambia el equipo no puede sacarse a si mismo', ids = array[beto]);
  select responsable_id is null into b from public.tareas where id = t1;
  perform public.zz_chk('al salir del equipo, sus tareas quedan sin responsable', b);
  perform public.zz_como(carla);
  select count(*) into n from public.proyectos where id = p1;
  perform public.zz_chk('carla ya no ve el proyecto', n = 0);

  perform public.zz_como(beto);
  begin
    perform public.salir_proyecto(p1);
    perform public.zz_chk('el unico miembro no puede salir', false);
  exception when others then
    perform public.zz_chk('el unico miembro no puede salir', sqlstate = '22023');
  end;
  perform public.guardar_miembros(p1, array[carla]);
  perform public.zz_como(carla);
  perform public.salir_proyecto(p1);
  perform public.zz_como(beto);
  select count(*) into n from public.miembros where proyecto_id = p1;
  perform public.zz_chk('con dos miembros, uno puede salir', n = 1);

  -- ── Resumen y actividad ──────────────────────────────────────────────────
  insert into public.tareas (proyecto_id, seccion_id, titulo, orden, fecha_vencimiento)
    values (p1, sec1, 'T2', 2, '2026-01-01') returning id into t2;
  select * into r from public.listar_proyectos(date '2026-06-01') where id = p1;
  perform public.zz_chk('listar_proyectos: 2 tareas principales, 1 vencida, equipo de 1',
    r.total = 2 and r.vencidas = 1 and r.completadas = 0 and r.miembros = array[beto]);
  perform public.zz_como(carla);
  select count(*) into n from public.listar_proyectos(date '2026-06-01') where id = p1;
  perform public.zz_chk('listar_proyectos no muestra proyectos ajenos', n = 0);
  perform public.zz_como(beto);
  select count(*) into n from public.actividad where proyecto_id = p1;
  perform public.zz_chk('la actividad se registra sola', n >= 3);

  -- ── Borrar un proyecto entero (cascada, sin chocar con la actividad) ───────
  delete from public.proyectos where id = p1;
  get diagnostics n = row_count;
  perform public.zz_chk('un miembro puede borrar el proyecto', n = 1);
  reset role;
  select (select count(*) from public.tareas where proyecto_id = p1)
       + (select count(*) from public.secciones where proyecto_id = p1)
       + (select count(*) from public.actividad where proyecto_id = p1) into n;
  perform public.zz_chk('no quedan huerfanos tras borrar el proyecto', n = 0);

  reset role;
  raise exception E'REPORTE\n%', current_setting('t.res', true);
end $$;
