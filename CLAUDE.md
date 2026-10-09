# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Que es esto

App de gestion de proyectos estilo Basecamp + Asana/Trello. Frontend sacado de
`E:\claude\app-base` (misma estructura, componentes `ui/`, tema, PWA) y backend
en **Supabase** (Postgres + Auth + una Edge Function). Roles `admin` (gestiona
usuarios) y `usuario`; cada proyecto lo ven solo sus miembros. Ver
[README.md](README.md) para producto, puesta en marcha y fases siguientes.

Historia: arranco con Google Apps Script + Sheets, y se cambio a Supabase por
latencia (1-3 s por accion, picos de 30 s) y porque el LockService de Apps
Script quedo trabado. Esa version esta en el tag `backend-apps-script`.

## Comandos

```bash
npm run dev        # vite, contra el proyecto de Supabase del .env
npm test           # vitest (logica del cliente)
npm run lint       # oxlint
npm run build      # tsc -b && vite build
npx vitest run src/lib/tareas.test.ts   # un solo archivo
```

Proyecto de Supabase: `projects-dr`, ref `mjksywaowgpefpgseldt` (org
diagomgs1-Org, sa-east-1). Las migraciones y la Edge Function se aplican con
las herramientas MCP de Supabase (`apply_migration`, `deploy_edge_function`);
los archivos en `supabase/` son la fuente y deben coincidir con lo aplicado.

## Arquitectura

### Seguridad: la RLS es el control de acceso

`supabase/migrations/002_seguridad.sql`. La UI nunca es el control de acceso:
el menu oculta lo que fallaria, lo que protege los datos es la politica.

- Un proyecto solo existe para sus miembros: `private.es_miembro(proyecto_id)`
  en las politicas de proyectos, miembros, secciones, etiquetas, tareas y
  actividad. Un no-miembro recibe cero filas (no un error): no se le confirma
  que el proyecto existe.
- El rol `admin` NO da acceso a proyectos ajenos (decision del dueño del
  producto): solo gestiona usuarios. Si algun dia hace falta que vea todo,
  es una politica nueva, no un parche en la UI.
- `private.usuario_activo()` / `es_admin()` / `es_miembro()` son `security
  definer` en el esquema `private` (PostgREST no lo expone). Hay que mantener
  `grant usage on schema private` y `execute` para `authenticated`.
- **Antes de conceder hay que revocar**: las tablas nuevas de `public` nacen
  con ALL para anon y authenticated. Cada tabla nueva: `enable row level
  security`, `revoke all ... from anon, authenticated`, y despues solo los
  grants necesarios (por columna cuando conviene: `proyecto_id`, `parent_id` y
  `creado_por` de tareas no se pueden reescribir).
- El cliente NO escribe en `usuarios` ni crea proyectos con un insert: las
  cuentas las maneja la Edge Function y los proyectos `crear_proyecto()`.
- Las operaciones que tocan varias tablas son funciones SQL (todo o nada):
  `crear_proyecto`, `guardar_miembros`, `salir_proyecto`, `eliminar_seccion`,
  `listar_proyectos`. Las `security definer` revisan por dentro quien llama.
- Los triggers de `tareas` (`validar_tarea`) hacen cumplir lo que no puede
  expresar una politica: seccion y responsable del mismo proyecto, subtareas de
  un solo nivel que heredan la seccion, `completada_en`, etiquetas validas.

**Probar la RLS**: `supabase/tests/rls_test.sql` (54 comprobaciones, simula
usuarios fijando `request.jwt.claim.sub` y el rol de Postgres, igual que
PostgREST). Se corre pegandolo en el SQL Editor o con `execute_sql`; termina
SIEMPRE con un `raise exception 'REPORTE ...'` a proposito, que descarta la
transaccion y trae el reporte en el mensaje. Un UPDATE/DELETE bloqueado por
`using` no tira error (afecta 0 filas): esos casos cuentan filas; los
bloqueados por permisos/`with check` tiran 42501. No confundirlos.
Correrlo despues de tocar politicas o funciones y sumar el caso nuevo.

### Edge Function `admin-usuarios`

Lo unico que usa la `service_role`. Se despliega con **verify_jwt
desactivado** y valida a mano: token contra Auth → fila en `usuarios` activa y
`rol = 'admin'` → recien ahi ejecuta. Acciones: `crear`, `editar`,
`setActivo` (banea tambien la cuenta de Auth), `password`. Un admin no puede
desactivarse ni cambiarse el rol a si mismo. Los errores salen con status HTTP
y `{ error: 'mensaje en español' }`; `datos.ts` los lee.

### Frontend: `src/`

- `lib/datos.ts` es el UNICO lugar que habla con la base: hooks y pantallas no
  conocen PostgREST. Todas lanzan `ErrorApp` con mensaje listo para mostrar
  (`lib/errores.ts`: los `raise exception` propios ya vienen en español).
  Un UPDATE/DELETE bloqueado por la RLS no da error: `exigeFila()` lo convierte
  en uno.
- `lib/tipos.ts`: tipos a mano, espejo de `001_schema.sql`.
- `hooks/useAuth.tsx`: patron de app-base. Conserva la guarda `cargaActual`
  contra cargas de perfil viejas y reacciona solo a un cambio REAL de usuario
  (supabase-js emite SIGNED_IN al volver el foco a la pestaña; ponerle
  `loading=true` desmontaria el `<Outlet>` y se perderia un formulario a medio
  llenar). El layout decide por `session`, no por `usuario`: una cuenta
  desactivada o sin perfil ve su explicacion en vez de rebotar al login.
  `errorConexion` (sin red) muestra "Reintentar" y NO cierra la sesion.
- Caches en memoria (stale-while-revalidate): `crearRecurso` para listas
  (`useUsuarios`, `useProyectos`, `useMisTareas`) y `hooks/useProyecto.ts` por
  proyecto. `resetearRecursos()` los vacia al cambiar de sesion.
  PostgREST corta en 1000 filas: usar `traerTodo()`.
- **Ediciones optimistas** (`useProyecto`): se aplican en pantalla, se escribe, y
  si falla → toast + recarga del proyecto. Lo creado tiene id `tmp-…` hasta que
  vuelve el real (`esTemporal`): no se puede abrir ni arrastrar mientras tanto.
  `invalidarResumenes()` marca viejos los resumenes de proyectos y Mis tareas.
- Secciones = listas (vista Lista) = columnas (vista Tablero). `orden` es
  fraccionario (`ordenEntre`): mover una tarjeta escribe una sola fila.
- Fechas de tareas: `date` en la base ('YYYY-MM-DD'); "hoy" se calcula en el
  navegador (`hoyISO`) y se le pasa a `listar_proyectos`.

## Al agregar cosas

- Tabla/columna nueva: migracion NUEVA (`003_…`, nunca editar las aplicadas),
  politica en la misma migracion, tipo en `lib/tipos.ts`, funcion en
  `lib/datos.ts`, y caso en `rls_test.sql`.
- Pantallas: ruta en `src/App.tsx` y link en `NAV_BASE` de `AppLayout`.
- Despues de cambiar el esquema: `get_advisors` (security) del MCP de Supabase.
  Los tres avisos de "security definer ejecutable por authenticated"
  (`crear_proyecto`, `guardar_miembros`, `salir_proyecto`) son intencionales.
- Fase de archivos: Google Drive (decision del dueño). `proyectos.drive_folder_id`
  ya existe. Una service account NO sirve con una cuenta Gmail personal (no
  tiene cuota de almacenamiento): hay que usar OAuth del usuario.
- `ui/tabla.tsx` tiene `ALTO_VISTA` que depende del relleno de `<main>` en
  `AppLayout` (heredado de app-base).
