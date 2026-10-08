# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Que es esto

App de gestion de proyectos estilo Basecamp + Asana/Trello. Frontend sacado de
`E:\claude\app-base` (misma estructura, componentes `ui/`, tema, PWA), pero sin
Supabase ni multiempresa: el backend es **Google Apps Script** sobre un
**Google Sheet** (base) y **Drive** (archivos, fase 2). Un solo nivel de
usuario; cada proyecto lo ven solo sus miembros. Ver [README.md](README.md)
para producto, puesta en marcha y fases siguientes.

## Comandos

```bash
npm run dev        # vite; sin VITE_GAS_URL levanta el backend local en /gas-local
npm test           # vitest: apps-script/tests/*.test.mjs + src/**/*.test.ts
npm run lint       # oxlint
npm run build      # tsc -b && vite build
npx vitest run apps-script/tests/backend.test.mjs   # solo el backend
npm run gas:push   # clasp push del backend (necesita apps-script/.clasp.json)
```

## Arquitectura

### Backend: `apps-script/` (Apps Script V8)

- Todos los `.js` comparten un scope global y se evaluan **en orden**: el
  codigo de nivel superior de un archivo no puede usar funciones de otro que
  venga despues. Por eso la tabla de acciones es `acciones_()` (una funcion)
  y no una constante. No agregar codigo top-level que dependa de otro archivo.
- `Router.js` → `manejar(req)`: `{accion, token, datos}` → `{ok, data}` o
  `{ok:false, error, codigo}`. Siempre HTTP 200 (Apps Script no deja elegir
  status). Acciones con `escribe: true` corren enteras bajo `LockService`.
- `Db.js` es la UNICA capa que toca el Sheet. `ESQUEMA` define tablas,
  columnas y tipos; todo se guarda como texto (las hojas tienen formato `@`)
  y se tipa al leer. Escribe respetando el orden REAL de los encabezados y
  conserva columnas extra agregadas a mano. Cache por request (se resetea en
  `manejar`); cualquier escritura invalida la tabla.
- Seguridad (el equivalente a la RLS de app-base): el usuario sale SIEMPRE de
  `usuarioDeToken(token)`, que relee su fila de Usuarios en cada request
  (desactivar corta en la proxima llamada). Toda accion sobre un proyecto, o
  sobre algo que cuelga de uno (tarea, seccion, etiqueta), pasa por
  `exigeMiembro()` antes de leer/escribir, y a un no-miembro se le contesta
  **404** (no 403). Al agregar una accion: registrarla en `acciones_()`,
  llamar a `exigeMiembro` y sumar el caso a la lista de "un no-miembro no
  puede escribir nada" en `apps-script/tests/backend.test.mjs`.
- Contraseñas: SHA-256 con sal e iteraciones (`hashPassword`), nunca salen
  del servidor (`usuarioPublico`). Login con bloqueo tras 5 fallos (CacheService).
- `Setup.js` → `setup()` es idempotente: crea Sheet/hojas/carpeta/primer
  usuario; si ya existen solo agrega lo que falte.

### Backend local y tests: `scripts/gas-local.mjs`

Carga los `.js` de `apps-script/` en un `vm` de Node con imitaciones en
memoria de SpreadsheetApp, CacheService, LockService, etc. Lo usan los tests
(prueban el backend REAL) y el plugin `gasLocal()` de `vite.config.ts`
(persistencia en `.gas-local/db.json`, usuario sembrado en `SEMBRADO_LOCAL`).
Si el backend empieza a usar otro metodo de Apps Script, hay que imitarlo
ahi o los tests fallan con "is not a function".

### Frontend: `src/`

- `lib/api.ts` → `gas(accion, datos)`: POST `text/plain` (con
  `application/json` el navegador haria un preflight CORS que Apps Script no
  contesta). Un `codigo: 401` borra el token y avisa a `useAuth`
  (`onSesionExpirada`) para volver al login.
- `lib/tipos.ts`: espejo a mano de `ESQUEMA`. Columnas `s?` llegan como `null`.
- `hooks/useAuth.tsx`: token en localStorage (`claveLocal('sesion')`),
  conserva la guarda `cargaActual` de app-base contra cargas viejas que pisan
  nuevas, y sincroniza el logout entre pestañas (evento `storage`).
- Caches en memoria (stale-while-revalidate): `crearRecurso` para listas
  (`useUsuarios`, `useProyectos`, `useMisTareas`) y `hooks/useProyecto.ts`
  para cada proyecto por id. `resetearRecursos()` los vacia todos al cambiar
  de sesion (`alResetearRecursos` registra caches que no son `crearRecurso`).
- **Ediciones optimistas** (`useProyecto`): se aplican en pantalla, se manda
  la escritura, y si falla → toast + recarga del proyecto entero. Lo creado
  tiene id `tmp-…` hasta que vuelve el real (`esTemporal`): no se puede
  abrir, arrastrar ni editar mientras tanto. Despues de tocar tareas,
  `invalidarResumenes()` marca viejos los resumenes de la lista de proyectos
  y "Mis tareas" (se revalidan al volver a verse, sin pedir nada ya).
- Secciones = listas (vista Lista) = columnas (vista Tablero). `orden` es
  fraccionario (`ordenEntre` en `lib/tareas.ts`): mover una tarjeta escribe
  una sola fila. Mover una tarea principal arrastra sus subtareas (cliente y
  servidor hacen lo mismo).
- Fechas de tareas: `'YYYY-MM-DD'` como texto; "hoy" se calcula en el
  navegador (`hoyISO`) y se le pasa al servidor cuando importa (`proyectos.listar`).

## Al agregar cosas

- La UI nunca es el control de acceso: lo es `exigeMiembro` en el backend.
- Tabla nueva: agregarla a `ESQUEMA` (Db.js) y a `lib/tipos.ts`; volver a
  correr `setup()` en produccion para que cree la hoja.
- Pantallas: ruta en `src/App.tsx` y link en `NAV` de `AppLayout`.
- Cada viaje a Apps Script cuesta ~1 s: preferir una accion que traiga todo
  lo de una pantalla (como `proyectos.cargar`) antes que varias chicas.
- `ui/tabla.tsx` tiene `ALTO_VISTA` que depende del relleno de `<main>` en
  `AppLayout` (heredado de app-base).
