# Proyectos DR

Gestión de proyectos al estilo **Basecamp** (cada proyecto con su equipo y sus
herramientas adentro), con funciones de **Asana / Trello**: tablero Kanban con
arrastrar y soltar, vista lista, "Mis tareas", subtareas, etiquetas,
prioridades y fechas.

Los datos viven en **tu Google Sheet** y los archivos (próxima fase) en **tu
Google Drive**, con **Google Apps Script** como backend. El frontend sale de
`app-base` (React + Vite + Tailwind, tema claro/oscuro, PWA instalable).

**Stack:** React 19 + TypeScript + Vite · Tailwind v4 · React Router · @dnd-kit ·
Google Apps Script (Sheets + Drive) · hosting estático (Vercel).

## Qué hay en esta versión (MVP)

| Módulo | Qué hace |
| --- | --- |
| Inicio | Proyectos activos, KPIs y lo tuyo que vence pronto. |
| Proyectos | Tarjetas con color, equipo, avance y vencidas. Buscar, archivar. |
| Proyecto → Tablero | Columnas = secciones. Arrastrar tarjetas entre columnas y dentro de cada una. Agregar/renombrar/mover/eliminar columnas. |
| Proyecto → Lista | Las mismas secciones como listas plegables (to-do lists de Basecamp). |
| Tarea (panel lateral) | Responsable, inicio, vencimiento, prioridad, sección, etiquetas, descripción, subtareas. Se guarda solo. Link compartible (`?tarea=…`). |
| Mis tareas | Todo lo asignado a vos en todos tus proyectos: vencidas, hoy, próximos 7 días, más adelante. |
| Usuarios | Alta, edición, desactivar, resetear contraseña. Un solo nivel de usuario. |
| Exportar | CSV de un proyecto o de "Mis tareas" (abre bien en Excel en español). |

**Permisos:** hay un solo nivel de usuario. Cada proyecto lo ven **solo sus
miembros**; quien lo crea queda adentro y puede sumar o sacar gente. Eso lo
garantiza el backend (no la interfaz): un no-miembro recibe "no encontrado"
aunque llame a la API directo con el id correcto.

## Cómo está armado

```
Navegador (React)  ──POST text/plain {accion, token, datos}──▶  Apps Script Web App
                                                                  │  Router → valida token → handler
                                                                  │  LockService en cada escritura
                                                                  ▼
                                                 Google Sheet: una hoja por tabla
                                                 Usuarios · Sesiones · Proyectos · Miembros
                                                 Secciones · Tareas · Etiquetas · Actividad
```

- `apps-script/` — el backend (se sube con `clasp`). `Db.js` es la única capa
  que toca el Sheet; `Router.js` lista todas las acciones.
- `src/` — el frontend. `lib/api.ts` (`gas()`) es el único punto que habla con
  el backend.
- `scripts/gas-local.mjs` — corre el backend en Node con un Sheet en memoria:
  lo usan los tests y `npm run dev` (ver abajo).

## Desarrollo local (sin desplegar nada)

```bash
npm install
npm run dev
```

Sin `VITE_GAS_URL` en `.env`, `npm run dev` levanta el **mismo código de
`apps-script/`** en `/gas-local`, sobre un Sheet en memoria guardado en
`.gas-local/db.json`. La primera vez crea el usuario de prueba definido en
`SEMBRADO_LOCAL` (`vite.config.ts`). Para empezar de cero, borrar
`.gas-local/`. Para simular la latencia real de Apps Script:
`GAS_LOCAL_DEMORA=900 npm run dev`.

```bash
npm test          # vitest: backend de Apps Script (aislamiento, auth...) + lógica del cliente
npm run lint      # oxlint
npm run build     # tsc + vite build
```

## Puesta en producción (una sola vez)

### 1. Backend en Apps Script

```bash
npm i -g @google/clasp
clasp login                          # con tu cuenta de Google
cd apps-script
clasp create --type standalone --title "Proyectos DR"   # crea .clasp.json
clasp push
```

En el editor de Apps Script (`clasp open`):

1. Elegir la función **`setup`** → **Ejecutar**. Pide permisos (Sheets y
   Drive) la primera vez. Crea el Sheet **"Proyectos DR — Base de datos"**
   dentro de una carpeta **"Proyectos DR"** en tu Drive, y el primer usuario
   con **tu email**. La contraseña aparece en el **Registro de ejecución**:
   cambiala al entrar (ícono de llave).
2. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
3. Copiar la URL (termina en `/exec`).

"Cualquier usuario" significa que la URL responde a cualquiera, no que los
datos sean públicos: todas las acciones salvo el login exigen un token de
sesión válido, y cada proyecto solo se muestra a sus miembros.

> Al cambiar el código del backend: `npm run gas:push` y después
> **Implementar → Administrar implementaciones → editar → Nueva versión**
> (la URL se mantiene).

### 2. Frontend

```bash
cp .env.example .env     # y pegar la URL en VITE_GAS_URL
npm run build
```

En Vercel: importar el repo y cargar `VITE_GAS_URL` en **Settings →
Environment Variables**. `vercel.json` ya reescribe las rutas a `index.html`.

## Editar el Sheet a mano

Se puede (es tu base): las celdas están en formato texto para que Sheets no
convierta fechas por su cuenta. Se pueden reordenar columnas o agregar
columnas propias (p. ej. "notas"): el backend las respeta. Lo que **no** hay
que hacer es renombrar los encabezados existentes. Volver a correr `setup()`
agrega hojas o columnas faltantes sin borrar nada.

## Límites a tener en cuenta

- Cada llamada a Apps Script tarda ~0,5–2 s. La interfaz es **optimista**
  (los cambios se ven al instante y se guardan por detrás; si falla, avisa y
  recarga), y abrir un proyecto trae todo en una sola llamada.
- Pensado para equipos chicos/medianos (decenas de usuarios, decenas de miles
  de tareas). Si crece más, se reemplaza `apps-script/Db.js` por otra base
  sin tocar el frontend.

## Próximas fases sugeridas

1. **Comunicación:** comentarios en tareas con @menciones, tablero de mensajes
   del proyecto, feed de actividad (la hoja `Actividad` ya se está llenando).
2. **Archivos:** carpeta de Drive por proyecto, adjuntos en tareas, docs.
3. **Agenda:** calendario e hitos, vista timeline (Gantt simple),
   notificaciones y resumen diario por email (MailApp + trigger),
   plantillas de proyecto, check-ins automáticos.

## PWA, tema y versionado

Igual que `app-base`: `app.config.json` + `name`/`version` de `package.json`
son la identidad de la app (título, manifest, iconos). Subir `version` es el
proceso de release completo (renueva el cache del service worker).
