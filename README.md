# Proyectos DR

Gestión de proyectos al estilo **Basecamp** (cada proyecto con su equipo y sus
herramientas adentro), con funciones de **Asana / Trello**: tablero Kanban con
arrastrar y soltar, vista lista, "Mis tareas", subtareas, etiquetas,
prioridades y fechas.

**Stack:** React 19 + TypeScript + Vite · Tailwind v4 · React Router · @dnd-kit ·
**Supabase** (Postgres + Auth + Edge Functions) · hosting estático (Vercel).
Sale de `app-base`: misma estructura, componentes, tema claro/oscuro y PWA.

> La primera versión usaba Google Apps Script + Google Sheets. Se reemplazó por
> Supabase por velocidad (1–3 s por acción y picos de 30 s) y porque un candado
> de escritura trabado dejaba la app sin poder guardar. Esa versión sigue en
> git: `git checkout backend-apps-script`.

## Qué incluye (MVP)

| Módulo | Qué hace |
| --- | --- |
| Inicio | Proyectos activos, KPIs y lo tuyo que vence pronto. |
| Proyectos | Tarjetas con color, equipo, avance y vencidas. Buscar, archivar. |
| Proyecto → Tablero | Columnas = secciones. Arrastrar tarjetas entre columnas y dentro de cada una. Agregar/renombrar/mover/eliminar columnas. |
| Proyecto → Lista | Las mismas secciones como listas plegables (to-do lists de Basecamp). |
| Tarea (panel lateral) | Responsable, inicio, vencimiento, prioridad, sección, etiquetas, descripción, subtareas. Se guarda solo. Link compartible (`?tarea=…`). |
| Mis tareas | Todo lo asignado a vos en todos tus proyectos: vencidas, hoy, próximos 7 días, más adelante. |
| Usuarios (solo admin) | Alta, edición, rol, activar/desactivar, resetear contraseña. |
| Exportar | CSV de un proyecto o de "Mis tareas" (abre bien en Excel en español). |

## Roles y permisos

| Rol | Puede |
| --- | --- |
| `admin` | Gestionar usuarios (crear, editar, cambiar rol, desactivar, resetear clave). **No** ve proyectos ajenos por ser admin. |
| `usuario` | Crear proyectos y trabajar en aquellos donde es miembro. |

**Cada proyecto lo ven solo sus miembros**, sea cual sea su rol. Quien lo crea
queda adentro y puede sumar o sacar gente. Eso lo garantiza **Row Level
Security en Postgres**, no la interfaz: aunque alguien llame a la API directo
con el id de un proyecto ajeno, la base no le devuelve nada.

Un usuario desactivado pierde el acceso en el acto (la RLS lo exige activo),
aunque su sesión siga abierta.

## Cómo está armado

```
Navegador (React) ──supabase-js──▶ Postgres (RLS)        lecturas y escrituras, protegidas por política
                  └─invoke──────▶ Edge Function admin-usuarios   alta/edición de usuarios (clave privada)
```

- `supabase/migrations/` — esquema y seguridad. `001_schema.sql` (tablas) y
  `002_seguridad.sql` (RLS, triggers de integridad, funciones).
- `supabase/functions/admin-usuarios/` — lo único que necesita la clave
  privada (`service_role`): crear cuentas, cambiar email/contraseña, desactivar.
  Solo responde a un admin; la verifica contra la base en cada pedido.
- `supabase/tests/rls_test.sql` — 54 comprobaciones de seguridad contra
  Postgres de verdad (ver "Pruebas").
- `src/lib/datos.ts` — **único** lugar donde la app habla con la base.

### Operaciones que son funciones SQL (no escrituras sueltas)
`crear_proyecto`, `guardar_miembros`, `salir_proyecto`, `eliminar_seccion` y
`listar_proyectos`: tocan varias tablas a la vez y tienen que ser "todo o nada".

## Puesta en marcha

### 1. Supabase (una sola vez)
El proyecto es `projects-dr` (región São Paulo). Las migraciones y la Edge
Function ya están aplicadas. Si hubiera que rehacerlo en otro proyecto: correr
`001_schema.sql` y `002_seguridad.sql` en el SQL Editor y desplegar
`supabase/functions/admin-usuarios` con **verify_jwt desactivado** (la función
valida el token por su cuenta).

**Primer administrador** — nadie puede darse de alta solo, así que el primero
se crea a mano:
1. Supabase → **Authentication → Users → Add user → Create new user**, con tu
   email y una contraseña, marcando **Auto Confirm User**.
2. Correr `supabase/primer_admin.sql` (cambiando el email) en el **SQL Editor**.
3. **Authentication → Sign In / Providers → desactivá "Allow new users to sign up"**.
   (Aunque alguien se registrara, sin fila en `usuarios` no accede a nada, pero
   no tiene por qué poder crear cuentas.)

### 2. Frontend
```bash
cp .env.example .env     # VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (Project Settings → API)
npm install
npm run dev
```
La clave `publishable`/`anon` es **pública por diseño**: lo que protege los
datos es la RLS. **Nunca** poner la `service_role` en una variable `VITE_*`.

### 3. Vercel
Importar el repo y cargar en **Settings → Environment Variables**:
`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. `vercel.json` ya reescribe las
rutas a `index.html`. Si se agregan o cambian después del primer deploy hay
que hacer **Redeploy** (las variables `VITE_*` quedan dentro del build).

## Pruebas

```bash
npm test         # vitest: lógica del cliente (orden, fechas, agrupaciones, recursos)
npm run lint     # oxlint
npm run build    # tsc + vite build
```

**Seguridad (RLS):** pegar `supabase/tests/rls_test.sql` entero en el SQL
Editor. Simula a un admin, usuarios comunes, un desactivado y a alguien sin
sesión, y comprueba que nadie ve ni toca lo que no debe. **Termina siempre con
un "error" `REPORTE …`**: es a propósito, descarta la transacción (no deja datos
de prueba) y el reporte viaja en el mensaje. Cada línea es `ok` o `FALLA`.
Correrlo después de cada cambio en políticas o funciones.

## Notas de operación

- **Plan gratis de Supabase:** un proyecto sin actividad por 7 días se **pausa**
  (se reactiva con un clic en el panel; los datos no se pierden).
- **Backups:** el plan gratis no incluye backups descargables automáticos;
  `Database → Backups` según el plan. Para exportar, `Table Editor → Export`.
- **Cambiar una política o función:** crear una migración nueva
  (`003_…sql`), no editar las ya aplicadas.

## Próximas fases sugeridas

1. **Comunicación:** comentarios en tareas con @menciones, tablero de mensajes
   del proyecto, feed de actividad (la tabla `actividad` ya se llena sola).
2. **Archivos:** carpeta de Google Drive por proyecto y adjuntos en tareas
   (`proyectos.drive_folder_id` ya existe).
3. **Agenda:** calendario e hitos, vista timeline (Gantt simple),
   notificaciones y resumen diario por email, plantillas de proyecto.
4. **Tiempo real:** que los cambios de otros aparezcan sin recargar (Supabase
   Realtime).

## PWA, tema y versionado

Igual que `app-base`: `app.config.json` + `name`/`version` de `package.json`
son la identidad de la app (título, manifest, iconos). Subir `version` es el
proceso de release completo (renueva el cache del service worker).
