-- Proyectos DR: esquema de datos.
--
-- Identidad: `usuarios` cuelga de auth.users (Supabase Auth guarda email y
-- contraseña). Roles: 'admin' (gestiona usuarios) y 'usuario'. Quien puede
-- ver un proyecto lo decide `miembros`, no el rol (ver 002_seguridad.sql).

create schema if not exists private;

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  email text not null,
  rol text not null default 'usuario' check (rol in ('admin', 'usuario')),
  activo boolean not null default true,
  color text not null default '#1659b5',
  creado_en timestamptz not null default now()
);
create unique index usuarios_email_unico on public.usuarios (lower(email));

create table public.proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  descripcion text not null default '',
  color text not null default '#1659b5',
  estado text not null default 'activo' check (estado in ('activo', 'archivado')),
  -- Fase de archivos: carpeta de Google Drive del proyecto.
  drive_folder_id text,
  creado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now()
);

create table public.miembros (
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  agregado_en timestamptz not null default now(),
  primary key (proyecto_id, usuario_id)
);
create index miembros_usuario_idx on public.miembros (usuario_id);

-- Secciones = listas (vista Lista) = columnas (vista Tablero).
create table public.secciones (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  -- Fraccionario: mover una tarjeta entre otras dos escribe UNA fila.
  orden double precision not null
);
create index secciones_proyecto_idx on public.secciones (proyecto_id);

create table public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  color text not null default '#64748b'
);
create index etiquetas_proyecto_idx on public.etiquetas (proyecto_id);

create table public.tareas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  -- Sin cascade a proposito: una seccion con tareas no se borra sin decir a donde van.
  seccion_id uuid not null references public.secciones (id),
  parent_id uuid references public.tareas (id) on delete cascade,
  titulo text not null check (length(trim(titulo)) > 0),
  descripcion text not null default '',
  responsable_id uuid references public.usuarios (id) on delete set null,
  fecha_inicio date,
  fecha_vencimiento date,
  prioridad text check (prioridad in ('baja', 'media', 'alta')),
  -- Ids de etiquetas del proyecto. Sin FK (es un arreglo): lo mantienen los triggers.
  etiquetas uuid[] not null default '{}',
  completada boolean not null default false,
  completada_en timestamptz,
  orden double precision not null,
  creado_por uuid references public.usuarios (id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index tareas_proyecto_idx on public.tareas (proyecto_id);
create index tareas_seccion_idx on public.tareas (seccion_id);
create index tareas_parent_idx on public.tareas (parent_id);
create index tareas_responsable_idx on public.tareas (responsable_id) where not completada;

create table public.actividad (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.proyectos (id) on delete cascade,
  usuario_id uuid references public.usuarios (id) on delete set null,
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  detalle text not null default '',
  fecha timestamptz not null default now()
);
create index actividad_proyecto_idx on public.actividad (proyecto_id, fecha desc);
