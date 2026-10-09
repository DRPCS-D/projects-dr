// Backend de Proyectos DR en UN solo archivo, generado con `npm run gas:bundle`.
// No editar a mano: los fuentes estan en apps-script/. Pegar entero en un
// archivo "Codigo" del editor de Apps Script (y que no haya ningun otro .gs).

// ═════════ Db.js ═════════

/**
 * Capa de datos sobre Google Sheets: una hoja = una tabla, fila 1 = encabezados.
 *
 * Todas las celdas se guardan como TEXTO (las hojas se formatean con '@' en
 * setup()): si no, Sheets convierte por su cuenta '2026-10-08' en una fecha,
 * '1e3' en un numero, etc., y lo que vuelve ya no es lo que se guardo. Los
 * tipos de cada columna estan en ESQUEMA y se aplican al leer y al escribir.
 *
 * Tipos:  s = texto · s? = texto o null · b = booleano · n = numero
 *         n? = numero o null · l = lista de ids (separados por coma)
 *
 * Si alguna vez se cambia de base (Postgres, Firestore...), este es el unico
 * archivo que habria que reescribir: los handlers solo usan leer / buscar /
 * porId / insertar / actualizar / borrar.
 */

const ESQUEMA = {
  Usuarios: {
    id: 's', nombre: 's', email: 's', password_hash: 's', salt: 's',
    activo: 'b', color: 's', creado_en: 's',
  },
  Sesiones: { token: 's', usuario_id: 's', creado_en: 's', expira_en: 's' },
  Proyectos: {
    id: 's', nombre: 's', descripcion: 's', color: 's', estado: 's',
    drive_folder_id: 's?', creado_por: 's', creado_en: 's',
  },
  Miembros: { proyecto_id: 's', usuario_id: 's', agregado_en: 's' },
  Secciones: { id: 's', proyecto_id: 's', nombre: 's', orden: 'n' },
  Tareas: {
    id: 's', proyecto_id: 's', seccion_id: 's', parent_id: 's?', titulo: 's',
    descripcion: 's', responsable_id: 's?', fecha_inicio: 's?', fecha_vencimiento: 's?',
    prioridad: 's?', etiquetas: 'l', completada: 'b', completada_en: 's?', orden: 'n',
    creado_por: 's', creado_en: 's', actualizado_en: 's',
  },
  Etiquetas: { id: 's', proyecto_id: 's', nombre: 's', color: 's' },
  Actividad: {
    id: 's', proyecto_id: 's', usuario_id: 's', accion: 's', entidad: 's',
    entidad_id: 's', detalle: 's', fecha: 's',
  },
}

/** Error "esperado": viaja al cliente con su mensaje y codigo tal cual. */
class ErrorApp extends Error {
  constructor(codigo, mensaje) {
    super(mensaje)
    this.codigo = codigo
  }
}

// ── Lectura: una sola llamada y cache compartido ──────────────────────────
//
// Leer hoja por hoja con SpreadsheetApp cuesta ~1 s CADA una, y abrir un
// proyecto necesita 6 tablas. Por eso:
//
//  1. Las tablas se leen todas juntas con UNA llamada a la API de Sheets
//     (Sheets.Spreadsheets.Values.batchGet, servicio avanzado habilitado en
//     appsscript.json). Si el servicio no estuviera activo, se cae a
//     SpreadsheetApp hoja por hoja (mas lento, pero anda).
//  2. Lo leido queda en CacheService (compartido entre requests) unos
//     minutos. Cada tabla tiene una "generacion" (g:<tabla>) que cambia con
//     cada escritura desde la app: el cache de una generacion vieja no se
//     vuelve a leer, asi que nadie ve datos viejos por cambios hechos en la
//     app. Lo editado A MANO en el Sheet tarda hasta TTL_CACHE_SEG en verse.
//  3. Las acciones que ESCRIBEN no leen del cache: leen el Sheet fresco
//     (bajo el lock), porque necesitan los numeros de fila reales.
//
// `Actividad` no se precarga: solo crece y casi nunca se lee.

const TTL_CACHE_SEG = 300
const TTL_GENERACION_SEG = 21600
const MAX_TROZO = 90000
const PRECARGA = ['Usuarios', 'Sesiones', 'Proyectos', 'Miembros', 'Secciones', 'Tareas', 'Etiquetas']

let _ss = null
let _tablas = {} // tabla -> filas ya parseadas (este request)
let _crudas = {} // tabla -> matriz de valores tal cual vino (encabezado incluido)
let _encabezados = {}
let _ultimaFila = {} // tabla -> ultima fila con datos, para insertar sin preguntarle al Sheet
let _soloSheet = false // true en las acciones que escriben
let _tocadas = {} // tablas escritas en este request
let _gens = null

function resetearCacheDb(escribe) {
  _ss = null
  _tablas = {}
  _crudas = {}
  _encabezados = {}
  _ultimaFila = {}
  _soloSheet = Boolean(escribe)
  _tocadas = {}
  _gens = null
}

function idLibro_() {
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID')
  if (!id) throw new ErrorApp(500, 'La base de datos no está configurada: correr setup() en Apps Script.')
  return id
}

function libro_() {
  if (!_ss) _ss = SpreadsheetApp.openById(idLibro_())
  return _ss
}

function hoja_(tabla) {
  const h = libro_().getSheetByName(tabla)
  if (!h) throw new ErrorApp(500, `Falta la hoja "${tabla}": correr setup() en Apps Script.`)
  return h
}

function columnas_(tabla) {
  const def = ESQUEMA[tabla]
  if (!def) throw new Error(`Tabla desconocida: ${tabla}`)
  return Object.keys(def)
}

function aCelda_(tipo, v) {
  if (tipo === 'b') return v === true || v === 'TRUE' ? 'TRUE' : 'FALSE'
  if (tipo === 'l') return Array.isArray(v) ? v.join(',') : String(v ?? '')
  if (v === null || v === undefined) return ''
  if (tipo === 'n' || tipo === 'n?') return v === '' ? '' : String(Number(v))
  return String(v)
}

function deCelda_(tipo, v) {
  // Con formato de texto todo vuelve como string, pero si alguien edito el
  // Sheet a mano puede aparecer un numero, un booleano o un Date. La API de
  // Sheets ademas omite las celdas vacias del final de cada fila (undefined).
  if (v === undefined || v === null) v = ''
  if (v instanceof Date) v = v.toISOString()
  switch (tipo) {
    case 'b': return v === true || String(v).toUpperCase() === 'TRUE'
    case 'n': return v === '' ? 0 : Number(v)
    case 'n?': return v === '' ? null : Number(v)
    case 's?': return v === '' ? null : String(v)
    case 'l': return v === '' ? [] : String(v).split(',').filter(Boolean)
    default: return String(v)
  }
}

// ── Cache compartido (CacheService) ───────────────────────────────────────

function cacheDb_() {
  return CacheService.getScriptCache()
}

function generaciones_() {
  if (_gens) return _gens
  const leidas = cacheDb_().getAll(Object.keys(ESQUEMA).map((t) => 'g:' + t)) || {}
  _gens = {}
  Object.keys(ESQUEMA).forEach((t) => {
    _gens[t] = leidas['g:' + t] || null
  })
  return _gens
}

function claveDatos_(tabla, gen) {
  return 'd:' + tabla + ':' + gen
}

/** Las tablas pedidas que esten vigentes en el cache: { tabla: valores }. */
function leerDelCache_(tablas) {
  const gens = generaciones_()
  const conGen = tablas.filter((t) => gens[t])
  if (conGen.length === 0) return {}
  const cache = cacheDb_()
  const cabeceras = cache.getAll(conGen.map((t) => claveDatos_(t, gens[t]))) || {}
  const out = {}
  const pedidos = []
  conGen.forEach((t) => {
    const cab = cabeceras[claveDatos_(t, gens[t])]
    if (!cab) return
    const info = JSON.parse(cab)
    if (info.v) out[t] = info.v
    else for (let i = 0; i < info.n; i++) pedidos.push({ t, clave: claveDatos_(t, gens[t]) + ':' + i })
  })
  // Tablas grandes: van partidas en trozos (CacheService acepta hasta 100 KB por valor).
  if (pedidos.length) {
    const trozos = cache.getAll(pedidos.map((x) => x.clave)) || {}
    const unidas = {}
    pedidos.forEach((x) => {
      if (unidas[x.t] === false) return
      const parte = trozos[x.clave]
      unidas[x.t] = parte === undefined || parte === null ? false : (unidas[x.t] || '') + parte
    })
    Object.keys(unidas).forEach((t) => {
      if (unidas[t] !== false) out[t] = JSON.parse(unidas[t])
    })
  }
  return out
}

/** Guarda tablas en el cache bajo su generacion actual (si una tabla no tiene, se le crea). */
function guardarEnCache_(leidas) {
  const gens = generaciones_()
  const nuevasGens = {}
  const valores = {}
  Object.keys(leidas).forEach((t) => {
    if (!gens[t]) {
      gens[t] = Utilities.getUuid().slice(0, 8)
      nuevasGens['g:' + t] = gens[t]
    }
    const json = JSON.stringify(leidas[t])
    const base = claveDatos_(t, gens[t])
    if (json.length <= MAX_TROZO) {
      valores[base] = JSON.stringify({ v: leidas[t] })
    } else {
      const n = Math.ceil(json.length / MAX_TROZO)
      valores[base] = JSON.stringify({ n })
      for (let i = 0; i < n; i++) valores[base + ':' + i] = json.slice(i * MAX_TROZO, (i + 1) * MAX_TROZO)
    }
  })
  try {
    const cache = cacheDb_()
    if (Object.keys(nuevasGens).length) cache.putAll(nuevasGens, TTL_GENERACION_SEG)
    cache.putAll(valores, TTL_CACHE_SEG)
  } catch (e) {
    // Cache lleno o valor demasiado grande: se sigue sin cache, no es un error.
    console.warn('No se pudo cachear: ' + e)
  }
}

/** Despues de escribir: nueva generacion para las tablas tocadas (su cache viejo deja de valer). */
function invalidarTocadas_() {
  const tablas = Object.keys(_tocadas)
  if (tablas.length === 0) return
  const nuevas = {}
  tablas.forEach((t) => {
    nuevas['g:' + t] = Utilities.getUuid().slice(0, 8)
  })
  cacheDb_().putAll(nuevas, TTL_GENERACION_SEG)
  _gens = null
}

// ── Lectura del Sheet ─────────────────────────────────────────────────────

/** Lee varias hojas. Con el servicio avanzado de Sheets es UNA sola llamada. */
function leerDelSheet_(tablas) {
  // La API de Sheets no ve lo que SpreadsheetApp tiene pendiente de escribir:
  // si este request ya escribio algo, primero se vuelca.
  if (Object.keys(_tocadas).length) SpreadsheetApp.flush()
  if (typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    try {
      const r = Sheets.Spreadsheets.Values.batchGet(idLibro_(), {
        ranges: tablas.map((t) => "'" + t + "'"),
        majorDimension: 'ROWS',
      })
      const out = {}
      tablas.forEach((t, i) => {
        out[t] = (r.valueRanges[i] && r.valueRanges[i].values) || []
      })
      return out
    } catch (e) {
      // Una hoja que falta hace fallar todo el batchGet: se sigue de a una
      // para que el error diga cual.
      console.warn('batchGet fallo, se lee hoja por hoja: ' + e)
    }
  }
  const out = {}
  tablas.forEach((t) => {
    out[t] = hoja_(t).getDataRange().getValues()
  })
  return out
}

/** Trae a memoria la tabla pedida y, de paso, todas las de PRECARGA que falten. */
function cargar_(tabla) {
  if (_crudas[tabla]) return
  const pedidas = PRECARGA.indexOf(tabla) === -1 ? [tabla] : PRECARGA.filter((t) => !_crudas[t])
  let faltan = pedidas
  if (!_soloSheet) {
    Object.assign(_crudas, leerDelCache_(pedidas))
    faltan = pedidas.filter((t) => !_crudas[t])
  }
  if (faltan.length) {
    const leidas = leerDelSheet_(faltan)
    Object.assign(_crudas, leidas)
    // En una escritura no se cachea: lo leido puede cambiar en este mismo request.
    if (!_soloSheet) guardarEnCache_(leidas)
  }
}

/** Todas las filas de una tabla, como objetos. `_fila` es el numero de fila en el Sheet. */
function leer(tabla) {
  if (_tablas[tabla]) return _tablas[tabla]
  const def = ESQUEMA[tabla]
  if (!def) throw new Error(`Tabla desconocida: ${tabla}`)
  cargar_(tabla)
  const valores = _crudas[tabla]
  const encabezados = (valores[0] || []).map(String)
  _encabezados[tabla] = encabezados
  if (_ultimaFila[tabla] === undefined) _ultimaFila[tabla] = valores.length
  const filas = []
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i] || []
    // Filas totalmente vacias (alguien borro el contenido a mano): se saltean.
    if (fila.every((c) => c === '' || c === null || c === undefined)) continue
    const obj = { _fila: i + 1, _crudo: fila }
    for (const col of Object.keys(def)) {
      const idx = encabezados.indexOf(col)
      obj[col] = deCelda_(def[col], idx === -1 ? '' : fila[idx])
    }
    filas.push(obj)
  }
  _tablas[tabla] = filas
  return filas
}

function buscar(tabla, filtro) {
  return leer(tabla).filter(filtro)
}

function porId(tabla, id) {
  if (!id) return null
  return leer(tabla).find((f) => f.id === id) || null
}

/** Encabezados reales de la hoja. Para insertar en una tabla grande no hace falta leerla entera. */
function encabezados_(tabla) {
  if (_encabezados[tabla]) return _encabezados[tabla]
  if (PRECARGA.indexOf(tabla) !== -1) {
    leer(tabla)
    return _encabezados[tabla]
  }
  const h = hoja_(tabla)
  const ancho = h.getLastColumn()
  _encabezados[tabla] = ancho ? h.getRange(1, 1, 1, ancho).getValues()[0].map(String) : []
  return _encabezados[tabla]
}

/** La tabla cambio en el Sheet: se descarta lo que habia en memoria de ella. */
function tocada_(tabla) {
  _tocadas[tabla] = true
  delete _tablas[tabla]
  delete _crudas[tabla]
}

/**
 * Arma la fila en el orden de los encabezados REALES de la hoja (alguien
 * pudo reordenar columnas a mano). Las columnas que no son del esquema (una
 * "notas" agregada a mano) conservan lo que tenian.
 */
function filaDe_(tabla, obj) {
  const def = ESQUEMA[tabla]
  const reales = encabezados_(tabla)
  const encabezados = reales.length ? reales : Object.keys(def)
  return encabezados.map((col, i) => {
    if (def[col]) return aCelda_(def[col], obj[col])
    return obj._crudo && obj._crudo[i] !== undefined ? obj._crudo[i] : ''
  })
}

/**
 * Proxima fila libre. Si la tabla ya se leyo en este request se sabe sin
 * preguntarle al Sheet (cada pregunta obliga a Apps Script a volcar las
 * escrituras pendientes y cuesta un viaje).
 */
function proximaFila_(tabla, h) {
  const n = _ultimaFila[tabla] !== undefined ? _ultimaFila[tabla] : h.getLastRow()
  return n + 1
}

function insertarFilas_(tabla, objs) {
  const h = hoja_(tabla)
  const filas = objs.map((o) => filaDe_(tabla, o))
  const desde = proximaFila_(tabla, h)
  h.getRange(desde, 1, filas.length, filas[0].length).setValues(filas)
  tocada_(tabla)
  _ultimaFila[tabla] = desde + filas.length - 1
}

/** Inserta y devuelve el objeto completo (con los tipos normalizados, sin `_fila`). */
function insertar(tabla, obj) {
  insertarFilas_(tabla, [obj])
  return normalizar_(tabla, obj)
}

function insertarVarios(tabla, objs) {
  if (objs.length === 0) return []
  insertarFilas_(tabla, objs)
  return objs.map((o) => normalizar_(tabla, o))
}

/** Aplica `cambios` a la fila con ese id. Devuelve el objeto actualizado o null si no existe. */
function actualizar(tabla, id, cambios) {
  const actual = porId(tabla, id)
  if (!actual) return null
  const nuevo = Object.assign({}, actual, cambios, { id: actual.id })
  const fila = filaDe_(tabla, nuevo)
  hoja_(tabla).getRange(actual._fila, 1, 1, fila.length).setValues([fila])
  // Se actualiza tambien en memoria: los numeros de fila no cambian, asi la
  // proxima escritura del request no tiene que volver a leer la tabla.
  _crudas[tabla][actual._fila - 1] = fila
  delete _tablas[tabla]
  _tocadas[tabla] = true
  return normalizar_(tabla, nuevo)
}

/** Borra todas las filas que cumplen el filtro. Devuelve cuantas. */
function borrar(tabla, filtro) {
  const filas = leer(tabla).filter(filtro).map((f) => f._fila)
  if (filas.length === 0) return 0
  const h = hoja_(tabla)
  // De abajo hacia arriba: borrar una fila corre las de abajo una posicion.
  filas.sort((a, b) => b - a).forEach((n) => h.deleteRow(n))
  tocada_(tabla)
  delete _ultimaFila[tabla]
  return filas.length
}

function normalizar_(tabla, obj) {
  const def = ESQUEMA[tabla]
  const out = {}
  for (const col of Object.keys(def)) out[col] = deCelda_(def[col], aCelda_(def[col], obj[col]))
  return out
}

/** Copia sin `_fila`/`_crudo`, para devolver al cliente. */
function limpio(obj) {
  if (!obj) return obj
  const out = Object.assign({}, obj)
  delete out._fila
  delete out._crudo
  return out
}

function uuid() {
  return Utilities.getUuid()
}

function ahora() {
  return new Date().toISOString()
}

/** Toda escritura pasa por aca: dos personas guardando a la vez no se pisan filas. */
function conLock(fn) {
  const lock = LockService.getScriptLock()
  if (!lock.tryLock(15000)) throw new ErrorApp(503, 'El servidor está ocupado. Intentá de nuevo en unos segundos.')
  try {
    return fn()
  } finally {
    // Aunque la accion haya fallado a mitad de camino, lo que alcanzo a
    // escribir cuenta. Primero que llegue al Sheet y despues invalidar el
    // cache: al reves, otro request podria cachear lo viejo como nuevo.
    if (Object.keys(_tocadas).length) {
      SpreadsheetApp.flush()
      invalidarTocadas_()
    }
    lock.releaseLock()
  }
}

// ═════════ Auth.js ═════════

/**
 * Login con email + contraseña contra la hoja Usuarios, y sesiones con token.
 *
 * - La contraseña nunca se guarda: se guarda sal + hash SHA-256 iterado.
 * - El token es aleatorio (dos UUID v4), vive en la hoja Sesiones y se cachea
 *   en CacheService para no leer esa hoja en cada request.
 * - El usuario de cada request SIEMPRE sale del token (usuarioDeToken): nunca
 *   se confia en un id que mande el cliente. Y se vuelve a leer su fila de
 *   Usuarios cada vez, asi desactivar a alguien corta su acceso en la proxima
 *   llamada aunque su sesion siga cacheada.
 */

const DIAS_SESION = 30
const ITERACIONES_HASH = 100
const MAX_INTENTOS = 5
const BLOQUEO_SEG = 600
const MIN_PASSWORD = 8

function hashPassword(password, salt) {
  const alg = Utilities.DigestAlgorithm.SHA_256
  const saltBytes = Utilities.newBlob(salt).getBytes()
  let h = Utilities.computeDigest(alg, salt + ':' + password, Utilities.Charset.UTF_8)
  for (let i = 0; i < ITERACIONES_HASH; i++) h = Utilities.computeDigest(alg, h.concat(saltBytes))
  return Utilities.base64Encode(h)
}

function nuevaSal_() {
  return Utilities.getUuid().replace(/-/g, '')
}

function nuevoToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '')
}

/** Campos de Usuarios que pueden salir del servidor (nunca hash ni sal). */
function usuarioPublico(u) {
  return { id: u.id, nombre: u.nombre, email: u.email, activo: u.activo, color: u.color, creado_en: u.creado_en }
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function validarPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new ErrorApp(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
  }
}

/** Devuelve { password_hash, salt } listos para guardar. */
function credencialesNuevas(password) {
  validarPassword(password)
  const salt = nuevaSal_()
  return { password_hash: hashPassword(password, salt), salt }
}

// ── Sesiones ──────────────────────────────────────────────────────────────

function cache_() {
  return CacheService.getScriptCache()
}

function usuarioDeToken(token) {
  if (!token || typeof token !== 'string') throw new ErrorApp(401, 'No autenticado.')

  let usuarioId = null
  const cacheado = cache_().get('s:' + token)
  if (cacheado) {
    const [id, expira] = cacheado.split('|')
    if (expira > ahora()) usuarioId = id
  }
  if (!usuarioId) {
    const sesion = buscar('Sesiones', (s) => s.token === token)[0]
    if (!sesion || sesion.expira_en <= ahora()) throw new ErrorApp(401, 'Tu sesión expiró. Volvé a iniciar sesión.')
    usuarioId = sesion.usuario_id
    cache_().put('s:' + token, usuarioId + '|' + sesion.expira_en, 21600)
  }

  const usuario = porId('Usuarios', usuarioId)
  if (!usuario || !usuario.activo) throw new ErrorApp(401, 'Tu cuenta está desactivada.')
  return usuario
}

/** Cierra todas las sesiones de un usuario, salvo `excepto` (la actual, al cambiar la propia clave). */
function cerrarSesionesDe(usuarioId, excepto) {
  const sesiones = buscar('Sesiones', (s) => s.usuario_id === usuarioId && s.token !== excepto)
  sesiones.forEach((s) => cache_().remove('s:' + s.token))
  borrar('Sesiones', (s) => s.usuario_id === usuarioId && s.token !== excepto)
}

// ── Acciones ──────────────────────────────────────────────────────────────

function authLogin(datos) {
  const email = normalizarEmail(datos.email)
  const password = String(datos.password || '')
  if (!email || !password) throw new ErrorApp(400, 'Completá email y contraseña.')

  const claveIntentos = 'f:' + email
  const intentos = Number(cache_().get(claveIntentos) || 0)
  if (intentos >= MAX_INTENTOS) {
    throw new ErrorApp(429, 'Demasiados intentos fallidos. Esperá unos minutos y volvé a probar.')
  }

  const usuario = buscar('Usuarios', (u) => u.email === email)[0]
  // Mismo mensaje para "no existe" y "clave mal": no revelar que emails hay.
  if (!usuario || hashPassword(password, usuario.salt) !== usuario.password_hash) {
    cache_().put(claveIntentos, String(intentos + 1), BLOQUEO_SEG)
    throw new ErrorApp(400, 'Email o contraseña incorrectos.')
  }
  if (!usuario.activo) throw new ErrorApp(403, 'Tu usuario fue desactivado. Contactá a otro miembro del equipo.')

  cache_().remove(claveIntentos)
  const n = ahora()
  // Limpieza oportunista: las sesiones vencidas de esta persona no sirven mas.
  borrar('Sesiones', (s) => s.usuario_id === usuario.id && s.expira_en <= n)

  const token = nuevoToken_()
  const expira = new Date(Date.now() + DIAS_SESION * 86400000).toISOString()
  insertar('Sesiones', { token, usuario_id: usuario.id, creado_en: n, expira_en: expira })
  return { token, usuario: usuarioPublico(usuario) }
}

function authYo(_datos, ctx) {
  return usuarioPublico(ctx.usuario)
}

function authLogout(_datos, ctx) {
  cache_().remove('s:' + ctx.token)
  borrar('Sesiones', (s) => s.token === ctx.token)
  return true
}

function authCambiarPassword(datos, ctx) {
  const u = ctx.usuario
  if (hashPassword(String(datos.actual || ''), u.salt) !== u.password_hash) {
    throw new ErrorApp(400, 'La contraseña actual no es correcta.')
  }
  actualizar('Usuarios', u.id, credencialesNuevas(datos.nueva))
  // Las otras sesiones abiertas (otro navegador, un celular perdido) se cierran.
  cerrarSesionesDe(u.id, ctx.token)
  return true
}

// ═════════ Usuarios.js ═════════

/**
 * Gestion de cuentas. Hay un solo nivel de usuario: cualquiera con sesion
 * puede dar de alta, editar, desactivar o resetear la clave de otra persona.
 * Lo unico que nadie puede hacer es desactivarse a si mismo (se quedaria
 * afuera sin forma de volver si es el ultimo activo).
 */

const COLORES_USUARIO = ['#1659b5', '#0f766e', '#7c3aed', '#c2410c', '#be123c', '#4d7c0f', '#0369a1', '#a16207']

function emailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function exigeEmailLibre_(email, excepto) {
  if (!emailValido_(email)) throw new ErrorApp(400, 'El email no es válido.')
  const otro = buscar('Usuarios', (u) => u.email === email && u.id !== excepto)[0]
  if (otro) throw new ErrorApp(409, 'Ya existe un usuario con ese email.')
}

function exigeUsuario_(id) {
  const u = porId('Usuarios', id)
  if (!u) throw new ErrorApp(404, 'Usuario no encontrado.')
  return u
}

function usuariosListar() {
  return leer('Usuarios').map(usuarioPublico)
}

function usuariosCrear(datos) {
  const nombre = String(datos.nombre || '').trim()
  const email = normalizarEmail(datos.email)
  if (!nombre) throw new ErrorApp(400, 'El nombre es obligatorio.')
  exigeEmailLibre_(email)
  const total = leer('Usuarios').length
  const u = insertar('Usuarios', Object.assign(
    {
      id: uuid(),
      nombre,
      email,
      activo: true,
      color: COLORES_USUARIO[total % COLORES_USUARIO.length],
      creado_en: ahora(),
    },
    credencialesNuevas(datos.password),
  ))
  return usuarioPublico(u)
}

function usuariosEditar(datos) {
  exigeUsuario_(datos.id)
  const nombre = String(datos.nombre || '').trim()
  const email = normalizarEmail(datos.email)
  if (!nombre) throw new ErrorApp(400, 'El nombre es obligatorio.')
  exigeEmailLibre_(email, datos.id)
  const cambios = { nombre, email }
  if (datos.color) cambios.color = String(datos.color)
  return usuarioPublico(actualizar('Usuarios', datos.id, cambios))
}

function usuariosSetActivo(datos, ctx) {
  exigeUsuario_(datos.id)
  const activo = datos.activo === true
  if (!activo && datos.id === ctx.usuario.id) throw new ErrorApp(400, 'No podés desactivar tu propio usuario.')
  const u = actualizar('Usuarios', datos.id, { activo })
  if (!activo) cerrarSesionesDe(datos.id)
  return usuarioPublico(u)
}

function usuariosPassword(datos, ctx) {
  exigeUsuario_(datos.id)
  actualizar('Usuarios', datos.id, credencialesNuevas(datos.password))
  // Con la clave reseteada, las sesiones que tenia esa persona dejan de valer.
  cerrarSesionesDe(datos.id, datos.id === ctx.usuario.id ? ctx.token : undefined)
  return true
}

// ═════════ Proyectos.js ═════════

/**
 * Proyectos y sus miembros.
 *
 * Regla de acceso (el equivalente de la RLS de app-base): un proyecto solo
 * existe para quien figura en Miembros. Cualquier accion que reciba un
 * proyecto_id — o una tarea/seccion/etiqueta, que cuelga de uno — pasa por
 * exigeMiembro() ANTES de leer o escribir nada. A un no-miembro se le
 * contesta 404 (no 403), para no confirmarle que el proyecto existe.
 */

const SECCIONES_INICIALES = ['Por hacer', 'En curso', 'Hecho']
const COLORES_PROYECTO = ['#1659b5', '#0f766e', '#7c3aed', '#c2410c', '#be123c', '#4d7c0f', '#0369a1', '#a16207']

function esMiembro(proyectoId, usuarioId) {
  return buscar('Miembros', (m) => m.proyecto_id === proyectoId && m.usuario_id === usuarioId).length > 0
}

function exigeMiembro(proyectoId, usuario) {
  const p = porId('Proyectos', proyectoId)
  if (!p || !esMiembro(proyectoId, usuario.id)) throw new ErrorApp(404, 'Proyecto no encontrado.')
  return p
}

function miembrosDe(proyectoId) {
  return buscar('Miembros', (m) => m.proyecto_id === proyectoId).map((m) => m.usuario_id)
}

/** Ids de usuarios existentes y activos, sin repetidos. Los que no existen se descartan. */
function usuariosValidos_(ids) {
  const activos = new Set(buscar('Usuarios', (u) => u.activo).map((u) => u.id))
  return [...new Set((ids || []).map(String))].filter((id) => activos.has(id))
}

function registrar(proyectoId, usuario, accion, entidad, entidadId, detalle) {
  insertar('Actividad', {
    id: uuid(),
    proyecto_id: proyectoId,
    usuario_id: usuario.id,
    accion,
    entidad,
    entidad_id: entidadId,
    detalle: detalle || '',
    fecha: ahora(),
  })
}

function datosProyecto_(datos, parcial) {
  const out = {}
  if (!parcial || datos.nombre !== undefined) {
    out.nombre = String(datos.nombre || '').trim()
    if (!out.nombre) throw new ErrorApp(400, 'El nombre del proyecto es obligatorio.')
  }
  if (!parcial || datos.descripcion !== undefined) out.descripcion = String(datos.descripcion || '').trim()
  if (datos.color) out.color = String(datos.color)
  return out
}

// ── Acciones ──────────────────────────────────────────────────────────────

/**
 * Proyectos de los que soy miembro, con un resumen de sus tareas.
 * `hoy` ('YYYY-MM-DD') lo manda el cliente: "vencida" depende de la zona
 * horaria de quien mira, no de la del servidor.
 */
function proyectosListar(datos, ctx) {
  const hoy = String(datos.hoy || ahora().slice(0, 10))
  const mios = new Set(buscar('Miembros', (m) => m.usuario_id === ctx.usuario.id).map((m) => m.proyecto_id))
  const tareas = leer('Tareas')
  const miembros = leer('Miembros')
  return leer('Proyectos')
    .filter((p) => mios.has(p.id))
    .map((p) => {
      const suyas = tareas.filter((t) => t.proyecto_id === p.id && !t.parent_id)
      return Object.assign(limpio(p), {
        miembros: miembros.filter((m) => m.proyecto_id === p.id).map((m) => m.usuario_id),
        resumen: {
          total: suyas.length,
          completadas: suyas.filter((t) => t.completada).length,
          vencidas: suyas.filter((t) => !t.completada && t.fecha_vencimiento && t.fecha_vencimiento < hoy).length,
        },
      })
    })
}

function proyectosCrear(datos, ctx) {
  const base = datosProyecto_(datos, false)
  const total = leer('Proyectos').length
  const p = insertar('Proyectos', Object.assign(
    {
      id: uuid(),
      color: COLORES_PROYECTO[total % COLORES_PROYECTO.length],
      estado: 'activo',
      drive_folder_id: null,
      creado_por: ctx.usuario.id,
      creado_en: ahora(),
    },
    base,
  ))
  // Quien lo crea siempre queda adentro.
  const ids = usuariosValidos_([ctx.usuario.id].concat(datos.miembros || []))
  const n = ahora()
  insertarVarios('Miembros', ids.map((id) => ({ proyecto_id: p.id, usuario_id: id, agregado_en: n })))
  insertarVarios('Secciones', SECCIONES_INICIALES.map((nombre, i) => ({
    id: uuid(), proyecto_id: p.id, nombre, orden: i + 1,
  })))
  registrar(p.id, ctx.usuario, 'creo', 'proyecto', p.id, p.nombre)
  return Object.assign(p, { miembros: ids, resumen: { total: 0, completadas: 0, vencidas: 0 } })
}

function proyectosEditar(datos, ctx) {
  exigeMiembro(datos.id, ctx.usuario)
  return limpio(actualizar('Proyectos', datos.id, datosProyecto_(datos, true)))
}

function proyectosArchivar(datos, ctx) {
  exigeMiembro(datos.id, ctx.usuario)
  const estado = datos.archivado ? 'archivado' : 'activo'
  registrar(datos.id, ctx.usuario, estado === 'archivado' ? 'archivo' : 'reactivo', 'proyecto', datos.id, '')
  return limpio(actualizar('Proyectos', datos.id, { estado }))
}

/** Reemplaza la lista de miembros. Quien hace el cambio no puede sacarse a si mismo desde aca. */
function proyectosMiembros(datos, ctx) {
  exigeMiembro(datos.id, ctx.usuario)
  const ids = usuariosValidos_([ctx.usuario.id].concat(datos.usuarios || []))
  const actuales = new Set(miembrosDe(datos.id))
  const nuevos = new Set(ids)
  borrar('Miembros', (m) => m.proyecto_id === datos.id && !nuevos.has(m.usuario_id))
  const n = ahora()
  insertarVarios('Miembros', ids.filter((id) => !actuales.has(id)).map((id) => ({
    proyecto_id: datos.id, usuario_id: id, agregado_en: n,
  })))
  return ids
}

/** Salir de un proyecto. Si era el ultimo miembro, el proyecto queda huerfano: no se permite. */
function proyectosSalir(datos, ctx) {
  exigeMiembro(datos.id, ctx.usuario)
  if (miembrosDe(datos.id).length <= 1) {
    throw new ErrorApp(400, 'Sos el único miembro: agregá a alguien más o eliminá el proyecto.')
  }
  borrar('Miembros', (m) => m.proyecto_id === datos.id && m.usuario_id === ctx.usuario.id)
  return true
}

function proyectosEliminar(datos, ctx) {
  exigeMiembro(datos.id, ctx.usuario)
  const id = datos.id
  borrar('Tareas', (t) => t.proyecto_id === id)
  borrar('Secciones', (s) => s.proyecto_id === id)
  borrar('Etiquetas', (e) => e.proyecto_id === id)
  borrar('Actividad', (a) => a.proyecto_id === id)
  borrar('Miembros', (m) => m.proyecto_id === id)
  borrar('Proyectos', (p) => p.id === id)
  return true
}

/** Todo lo que necesita la pantalla de un proyecto, en UNA llamada (cada viaje a Apps Script cuesta ~1 s). */
function proyectosCargar(datos, ctx) {
  const p = exigeMiembro(datos.id, ctx.usuario)
  const id = p.id
  return {
    proyecto: Object.assign(limpio(p), { miembros: miembrosDe(id) }),
    secciones: buscar('Secciones', (s) => s.proyecto_id === id).map(limpio),
    tareas: buscar('Tareas', (t) => t.proyecto_id === id).map(limpio),
    etiquetas: buscar('Etiquetas', (e) => e.proyecto_id === id).map(limpio),
  }
}

// ═════════ Tareas.js ═════════

/**
 * Tareas, secciones y etiquetas de un proyecto.
 *
 * Secciones = listas (vista Lista) = columnas (vista Tablero), como en Asana:
 * una sola fuente de verdad para las dos vistas.
 *
 * `orden` es fraccionario: mover una tarjeta entre otras dos le pone el
 * promedio de sus ordenes (lo calcula el cliente), asi un drag & drop
 * escribe UNA fila en vez de renumerar toda la columna.
 */

const PRIORIDADES = ['baja', 'media', 'alta']
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function fechaOpcional_(v, campo) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  if (!FECHA_RE.test(s)) throw new ErrorApp(400, `La fecha "${campo}" no es válida.`)
  return s
}

function exigeTarea_(id, usuario) {
  const t = porId('Tareas', id)
  if (!t) throw new ErrorApp(404, 'Tarea no encontrada.')
  exigeMiembro(t.proyecto_id, usuario)
  return t
}

function exigeSeccionDe_(seccionId, proyectoId) {
  const s = porId('Secciones', seccionId)
  if (!s || s.proyecto_id !== proyectoId) throw new ErrorApp(400, 'La sección no pertenece al proyecto.')
  return s
}

/**
 * Valida y normaliza los campos editables de una tarea. Solo procesa los que
 * vienen en `datos` (para editar de a un campo).
 */
function camposTarea_(datos, proyectoId) {
  const out = {}
  if (datos.titulo !== undefined) {
    out.titulo = String(datos.titulo || '').trim()
    if (!out.titulo) throw new ErrorApp(400, 'El título es obligatorio.')
  }
  if (datos.descripcion !== undefined) out.descripcion = String(datos.descripcion || '')
  if (datos.responsable_id !== undefined) {
    const r = datos.responsable_id || null
    if (r && !esMiembro(proyectoId, r)) throw new ErrorApp(400, 'El responsable tiene que ser miembro del proyecto.')
    out.responsable_id = r
  }
  if (datos.fecha_inicio !== undefined) out.fecha_inicio = fechaOpcional_(datos.fecha_inicio, 'inicio')
  if (datos.fecha_vencimiento !== undefined) out.fecha_vencimiento = fechaOpcional_(datos.fecha_vencimiento, 'vencimiento')
  if (datos.prioridad !== undefined) {
    const p = datos.prioridad || null
    if (p && PRIORIDADES.indexOf(p) === -1) throw new ErrorApp(400, 'Prioridad inválida.')
    out.prioridad = p
  }
  if (datos.etiquetas !== undefined) {
    const validas = new Set(buscar('Etiquetas', (e) => e.proyecto_id === proyectoId).map((e) => e.id))
    out.etiquetas = [...new Set(datos.etiquetas || [])].filter((id) => validas.has(id))
  }
  if (datos.seccion_id !== undefined) out.seccion_id = exigeSeccionDe_(datos.seccion_id, proyectoId).id
  if (datos.orden !== undefined) {
    const o = Number(datos.orden)
    if (!isFinite(o)) throw new ErrorApp(400, 'Orden inválido.')
    out.orden = o
  }
  if (datos.completada !== undefined) {
    out.completada = datos.completada === true
    out.completada_en = out.completada ? ahora() : null
  }
  return out
}

// ── Tareas ────────────────────────────────────────────────────────────────

function tareasCrear(datos, ctx) {
  const proyecto = exigeMiembro(datos.proyecto_id, ctx.usuario)
  let padre = null
  if (datos.parent_id) {
    padre = porId('Tareas', datos.parent_id)
    if (!padre || padre.proyecto_id !== proyecto.id) throw new ErrorApp(400, 'La tarea principal no es de este proyecto.')
    if (padre.parent_id) throw new ErrorApp(400, 'Las subtareas no pueden tener subtareas.')
  }
  // Una subtarea vive en la seccion de su tarea principal.
  const seccionId = padre ? padre.seccion_id : datos.seccion_id
  exigeSeccionDe_(seccionId, proyecto.id)

  const campos = camposTarea_(
    Object.assign({ descripcion: '', etiquetas: [] }, datos, { completada: undefined, seccion_id: undefined, orden: undefined }),
    proyecto.id,
  )
  if (!campos.titulo) throw new ErrorApp(400, 'El título es obligatorio.')

  const hermanas = buscar('Tareas', (t) =>
    padre ? t.parent_id === padre.id : t.seccion_id === seccionId && !t.parent_id,
  )
  const orden = datos.orden !== undefined && isFinite(Number(datos.orden))
    ? Number(datos.orden)
    : hermanas.reduce((max, t) => Math.max(max, t.orden), 0) + 1

  const n = ahora()
  const t = insertar('Tareas', Object.assign(
    {
      id: uuid(),
      proyecto_id: proyecto.id,
      seccion_id: seccionId,
      parent_id: padre ? padre.id : null,
      responsable_id: null,
      fecha_inicio: null,
      fecha_vencimiento: null,
      prioridad: null,
      completada: false,
      completada_en: null,
      orden,
      creado_por: ctx.usuario.id,
      creado_en: n,
      actualizado_en: n,
    },
    campos,
  ))
  registrar(proyecto.id, ctx.usuario, 'creo', 'tarea', t.id, t.titulo)
  return t
}

function tareasEditar(datos, ctx) {
  const t = exigeTarea_(datos.id, ctx.usuario)
  const campos = camposTarea_(Object.assign({}, datos, { id: undefined }), t.proyecto_id)
  delete campos.id
  // Una subtarea no se mueve de seccion por su cuenta: sigue a su principal.
  if (t.parent_id) delete campos.seccion_id
  campos.actualizado_en = ahora()
  const nueva = actualizar('Tareas', t.id, campos)

  // Mover una tarea principal arrastra sus subtareas a la misma seccion.
  if (!t.parent_id && campos.seccion_id && campos.seccion_id !== t.seccion_id) {
    buscar('Tareas', (s) => s.parent_id === t.id).forEach((s) => {
      actualizar('Tareas', s.id, { seccion_id: campos.seccion_id })
    })
  }
  if (campos.completada !== undefined && campos.completada !== t.completada) {
    registrar(t.proyecto_id, ctx.usuario, campos.completada ? 'completo' : 'reabrio', 'tarea', t.id, t.titulo)
  } else if (campos.seccion_id && campos.seccion_id !== t.seccion_id) {
    const s = porId('Secciones', campos.seccion_id)
    registrar(t.proyecto_id, ctx.usuario, 'movio', 'tarea', t.id, `${t.titulo} → ${s ? s.nombre : ''}`)
  }
  return nueva
}

function tareasEliminar(datos, ctx) {
  const t = exigeTarea_(datos.id, ctx.usuario)
  borrar('Tareas', (x) => x.id === t.id || x.parent_id === t.id)
  registrar(t.proyecto_id, ctx.usuario, 'elimino', 'tarea', t.id, t.titulo)
  return true
}

/**
 * "Mis tareas" (Asana): lo asignado a mi en todos los proyectos activos de
 * los que sigo siendo miembro. Las completadas solo si se piden, y solo las
 * de los ultimos 14 dias (para no bajar el historial entero).
 */
function tareasMias(datos, ctx) {
  const yo = ctx.usuario.id
  const mios = new Set(buscar('Miembros', (m) => m.usuario_id === yo).map((m) => m.proyecto_id))
  const proyectos = {}
  leer('Proyectos').forEach((p) => {
    if (mios.has(p.id) && p.estado === 'activo') proyectos[p.id] = { id: p.id, nombre: p.nombre, color: p.color }
  })
  const secciones = {}
  leer('Secciones').forEach((s) => { secciones[s.id] = s.nombre })
  const desde = new Date(Date.now() - 14 * 86400000).toISOString()
  return buscar('Tareas', (t) =>
    t.responsable_id === yo &&
    proyectos[t.proyecto_id] &&
    (!t.completada || (datos.incluirCompletadas && t.completada_en && t.completada_en >= desde)),
  ).map((t) => Object.assign(limpio(t), {
    proyecto: proyectos[t.proyecto_id],
    seccion_nombre: secciones[t.seccion_id] || '',
  }))
}

// ── Secciones ─────────────────────────────────────────────────────────────

function seccionesCrear(datos, ctx) {
  const p = exigeMiembro(datos.proyecto_id, ctx.usuario)
  const nombre = String(datos.nombre || '').trim()
  if (!nombre) throw new ErrorApp(400, 'El nombre de la sección es obligatorio.')
  const max = buscar('Secciones', (s) => s.proyecto_id === p.id).reduce((m, s) => Math.max(m, s.orden), 0)
  return insertar('Secciones', { id: uuid(), proyecto_id: p.id, nombre, orden: max + 1 })
}

function exigeSeccion_(id, usuario) {
  const s = porId('Secciones', id)
  if (!s) throw new ErrorApp(404, 'Sección no encontrada.')
  exigeMiembro(s.proyecto_id, usuario)
  return s
}

function seccionesEditar(datos, ctx) {
  exigeSeccion_(datos.id, ctx.usuario)
  const cambios = {}
  if (datos.nombre !== undefined) {
    cambios.nombre = String(datos.nombre || '').trim()
    if (!cambios.nombre) throw new ErrorApp(400, 'El nombre de la sección es obligatorio.')
  }
  if (datos.orden !== undefined) {
    if (!isFinite(Number(datos.orden))) throw new ErrorApp(400, 'Orden inválido.')
    cambios.orden = Number(datos.orden)
  }
  return limpio(actualizar('Secciones', datos.id, cambios))
}

/** Si la seccion tiene tareas, hay que decir a que otra seccion pasan (`mover_a`). */
function seccionesEliminar(datos, ctx) {
  const s = exigeSeccion_(datos.id, ctx.usuario)
  const delProyecto = buscar('Secciones', (x) => x.proyecto_id === s.proyecto_id)
  if (delProyecto.length <= 1) throw new ErrorApp(400, 'Un proyecto necesita al menos una sección.')
  const tareas = buscar('Tareas', (t) => t.seccion_id === s.id)
  if (tareas.length > 0) {
    if (!datos.mover_a || datos.mover_a === s.id) throw new ErrorApp(400, 'Elegí a qué sección pasan sus tareas.')
    const destino = exigeSeccionDe_(datos.mover_a, s.proyecto_id)
    let max = buscar('Tareas', (t) => t.seccion_id === destino.id && !t.parent_id).reduce((m, t) => Math.max(m, t.orden), 0)
    tareas.sort((a, b) => a.orden - b.orden).forEach((t) => {
      actualizar('Tareas', t.id, t.parent_id ? { seccion_id: destino.id } : { seccion_id: destino.id, orden: ++max })
    })
  }
  borrar('Secciones', (x) => x.id === s.id)
  return true
}

// ── Etiquetas ─────────────────────────────────────────────────────────────

function datosEtiqueta_(datos) {
  const nombre = String(datos.nombre || '').trim()
  if (!nombre) throw new ErrorApp(400, 'El nombre de la etiqueta es obligatorio.')
  return { nombre, color: String(datos.color || '#64748b') }
}

function exigeEtiqueta_(id, usuario) {
  const e = porId('Etiquetas', id)
  if (!e) throw new ErrorApp(404, 'Etiqueta no encontrada.')
  exigeMiembro(e.proyecto_id, usuario)
  return e
}

function etiquetasCrear(datos, ctx) {
  const p = exigeMiembro(datos.proyecto_id, ctx.usuario)
  return insertar('Etiquetas', Object.assign({ id: uuid(), proyecto_id: p.id }, datosEtiqueta_(datos)))
}

function etiquetasEditar(datos, ctx) {
  exigeEtiqueta_(datos.id, ctx.usuario)
  return limpio(actualizar('Etiquetas', datos.id, datosEtiqueta_(datos)))
}

function etiquetasEliminar(datos, ctx) {
  const e = exigeEtiqueta_(datos.id, ctx.usuario)
  buscar('Tareas', (t) => t.proyecto_id === e.proyecto_id && t.etiquetas.indexOf(e.id) !== -1).forEach((t) => {
    actualizar('Tareas', t.id, { etiquetas: t.etiquetas.filter((x) => x !== e.id) })
  })
  borrar('Etiquetas', (x) => x.id === e.id)
  return true
}

// ═════════ Router.js ═════════

/**
 * Punto de entrada de la Web App.
 *
 * El cliente manda POST con Content-Type text/plain (asi el navegador no
 * hace preflight CORS, que Apps Script no sabe contestar) y un JSON:
 *     { accion: 'tareas.crear', token: '...', datos: {...} }
 * y recibe siempre HTTP 200 con:
 *     { ok: true, data }   o   { ok: false, error: 'mensaje', codigo: 400 }
 * (Apps Script no deja elegir el status HTTP: el codigo viaja en el cuerpo).
 *
 * `escribe: true` hace que la accion corra entera bajo LockService.
 *
 * La tabla se arma dentro de una funcion y no como constante global: Apps
 * Script ejecuta los archivos en orden, y al evaluar este (Router) todavia
 * no existen las funciones de los que vienen despues (Tareas, Usuarios...).
 */

function acciones_() {
  return {
    'auth.login': { fn: authLogin, publica: true, escribe: true },
    'auth.yo': { fn: authYo },
    'auth.logout': { fn: authLogout, escribe: true },
    'auth.cambiarPassword': { fn: authCambiarPassword, escribe: true },

    'usuarios.listar': { fn: usuariosListar },
    'usuarios.crear': { fn: usuariosCrear, escribe: true },
    'usuarios.editar': { fn: usuariosEditar, escribe: true },
    'usuarios.setActivo': { fn: usuariosSetActivo, escribe: true },
    'usuarios.password': { fn: usuariosPassword, escribe: true },

    'proyectos.listar': { fn: proyectosListar },
    'proyectos.cargar': { fn: proyectosCargar },
    'proyectos.crear': { fn: proyectosCrear, escribe: true },
    'proyectos.editar': { fn: proyectosEditar, escribe: true },
    'proyectos.archivar': { fn: proyectosArchivar, escribe: true },
    'proyectos.miembros': { fn: proyectosMiembros, escribe: true },
    'proyectos.salir': { fn: proyectosSalir, escribe: true },
    'proyectos.eliminar': { fn: proyectosEliminar, escribe: true },

    'secciones.crear': { fn: seccionesCrear, escribe: true },
    'secciones.editar': { fn: seccionesEditar, escribe: true },
    'secciones.eliminar': { fn: seccionesEliminar, escribe: true },

    'tareas.mias': { fn: tareasMias },
    'tareas.crear': { fn: tareasCrear, escribe: true },
    'tareas.editar': { fn: tareasEditar, escribe: true },
    'tareas.eliminar': { fn: tareasEliminar, escribe: true },

    'etiquetas.crear': { fn: etiquetasCrear, escribe: true },
    'etiquetas.editar': { fn: etiquetasEditar, escribe: true },
    'etiquetas.eliminar': { fn: etiquetasEliminar, escribe: true },
  }
}

/** Logica del router, separada de doPost para poder probarla sin HTTP. */
function manejar(req) {
  const inicio = Date.now()
  // `ms` (tiempo del lado del servidor) viaja en cada respuesta: sirve para
  // ver desde el navegador si lo lento es Apps Script o la red.
  const conTiempo = (r) => Object.assign(r, { ms: Date.now() - inicio })
  resetearCacheDb(false)
  try {
    if (!req || typeof req !== 'object') throw new ErrorApp(400, 'Pedido inválido.')
    const tabla = acciones_()
    const accion = Object.prototype.hasOwnProperty.call(tabla, req.accion) ? tabla[req.accion] : null
    if (!accion) throw new ErrorApp(400, `Acción desconocida: ${req.accion}`)
    const datos = req.datos && typeof req.datos === 'object' ? req.datos : {}

    const ejecutar = () => {
      // Las escrituras leen el Sheet fresco, no el cache (ver Db.js).
      resetearCacheDb(Boolean(accion.escribe))
      const ctx = { token: req.token, usuario: accion.publica ? null : usuarioDeToken(req.token) }
      return accion.fn(datos, ctx)
    }
    const data = accion.escribe ? conLock(ejecutar) : ejecutar()
    return conTiempo({ ok: true, data: data === undefined ? null : data })
  } catch (err) {
    if (err instanceof ErrorApp) return conTiempo({ ok: false, error: err.message, codigo: err.codigo })
    console.error(err && err.stack ? err.stack : err)
    return conTiempo({ ok: false, error: 'Error interno del servidor.', codigo: 500 })
  }
}

function respuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function doPost(e) {
  let req = null
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}')
  } catch (_err) {
    return respuesta_({ ok: false, error: 'JSON inválido.', codigo: 400 })
  }
  return respuesta_(manejar(req))
}

/** GET solo sirve para comprobar que la URL de la implementacion es la correcta. */
function doGet() {
  return respuesta_({ ok: true, data: { servicio: 'Proyectos DR', estado: 'ok' } })
}

// ═════════ Setup.js ═════════

/**
 * Instalacion, se corre UNA vez a mano desde el editor de Apps Script
 * (seleccionar `setup` → Ejecutar). Es idempotente: correrlo de nuevo solo
 * agrega las hojas o columnas que falten, nunca borra datos.
 *
 *  1. Crea el Google Sheet "Proyectos DR — Base de datos" (o reusa el de DB_ID).
 *  2. Crea una hoja por tabla de ESQUEMA, con encabezados y formato de texto.
 *  3. Crea la carpeta de Drive "Proyectos DR" y mueve el Sheet adentro
 *     (ahi van a ir las carpetas de cada proyecto en la fase de Archivos).
 *  4. Si no hay ningun usuario, crea el primero con el email de quien
 *     ejecuta y una contraseña aleatoria que se muestra en el registro de
 *     ejecucion. Cambiarla al entrar (icono de llave).
 */

const NOMBRE_SISTEMA = 'Proyectos DR'

function setup() {
  const props = PropertiesService.getScriptProperties()
  let ss
  const idExistente = props.getProperty('DB_ID')
  if (idExistente) {
    ss = SpreadsheetApp.openById(idExistente)
  } else {
    ss = SpreadsheetApp.create(NOMBRE_SISTEMA + ' — Base de datos')
    props.setProperty('DB_ID', ss.getId())
  }

  prepararHojas_(ss)

  if (!props.getProperty('DRIVE_ID')) {
    const carpeta = DriveApp.createFolder(NOMBRE_SISTEMA)
    props.setProperty('DRIVE_ID', carpeta.getId())
    DriveApp.getFileById(ss.getId()).moveTo(carpeta)
  }

  // Como cualquier escritura: lee el Sheet fresco, con lock, e invalida el cache.
  conLock(() => {
    resetearCacheDb(true)
    // Las columnas nuevas que haya agregado prepararHojas_ cambian lo cacheado.
    Object.keys(ESQUEMA).forEach((t) => { _tocadas[t] = true })
    if (leer('Usuarios').length === 0) {
      const email = normalizarEmail(props.getProperty('SETUP_EMAIL') || Session.getEffectiveUser().getEmail())
      const password = props.getProperty('SETUP_PASSWORD') || Utilities.getUuid().slice(0, 12)
      const nombre = props.getProperty('SETUP_NOMBRE') || email.split('@')[0]
      usuariosCrear({ nombre, email, password })
      Logger.log('Primer usuario creado: ' + email + ' / contraseña: ' + password + '  (cambiala al entrar)')
    }
  })

  Logger.log('Listo. Base: ' + ss.getUrl())
  return ss.getId()
}

function prepararHojas_(ss) {
  Object.keys(ESQUEMA).forEach((tabla) => {
    const columnas = Object.keys(ESQUEMA[tabla])
    let hoja = ss.getSheetByName(tabla)
    if (!hoja) hoja = ss.insertSheet(tabla)

    // Columnas que falten se agregan al final: nunca se reordena ni se pisa nada.
    const actuales = hoja.getLastColumn() > 0
      ? hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String).filter(Boolean)
      : []
    const encabezados = actuales.concat(columnas.filter((c) => actuales.indexOf(c) === -1))
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold')
    hoja.setFrozenRows(1)
    // Todo como texto, para que Sheets no convierta fechas ni numeros por su cuenta.
    hoja.getRange(1, 1, hoja.getMaxRows(), encabezados.length).setNumberFormat('@')
  })

  // La hoja vacia que trae todo Sheet nuevo ("Hoja 1" / "Sheet1") sobra.
  ss.getSheets().forEach((h) => {
    if (!ESQUEMA[h.getName()] && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h)
  })
}
