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
