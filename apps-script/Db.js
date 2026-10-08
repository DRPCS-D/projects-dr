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

// ── Cache por request ──────────────────────────────────────────────────────
// Cada llamada a la web app arranca de cero (resetearCacheDb en el Router):
// dentro de una misma accion, leer dos veces la misma tabla no vuelve a pegarle
// al Sheet. Cualquier escritura invalida esa tabla.
let _ss = null
let _tablas = {}
let _encabezados = {}

function resetearCacheDb() {
  _ss = null
  _tablas = {}
  _encabezados = {}
}

function libro_() {
  if (_ss) return _ss
  const id = PropertiesService.getScriptProperties().getProperty('DB_ID')
  if (!id) throw new ErrorApp(500, 'La base de datos no está configurada: correr setup() en Apps Script.')
  _ss = SpreadsheetApp.openById(id)
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
  // Sheet a mano puede aparecer un numero, un booleano o un Date.
  if (v instanceof Date) v = v.toISOString()
  switch (tipo) {
    case 'b': return v === true || String(v).toUpperCase() === 'TRUE'
    case 'n': return v === '' ? 0 : Number(v)
    case 'n?': return v === '' ? null : Number(v)
    case 's?': return v === '' || v === null ? null : String(v)
    case 'l': return v === '' || v === null ? [] : String(v).split(',').filter(Boolean)
    default: return v === null ? '' : String(v)
  }
}

/** Todas las filas de una tabla, como objetos. `_fila` es el numero de fila en el Sheet. */
function leer(tabla) {
  if (_tablas[tabla]) return _tablas[tabla]
  const def = ESQUEMA[tabla]
  const valores = hoja_(tabla).getDataRange().getValues()
  const encabezados = (valores[0] || []).map(String)
  _encabezados[tabla] = encabezados
  const filas = []
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i]
    // Filas totalmente vacias (alguien borro el contenido a mano): se saltean.
    if (fila.every((c) => c === '' || c === null)) continue
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

/**
 * Arma la fila en el orden de los encabezados REALES de la hoja (alguien
 * pudo reordenar columnas a mano). Las columnas que no son del esquema (una
 * "notas" agregada a mano) conservan lo que tenian.
 */
function filaDe_(tabla, obj) {
  const def = ESQUEMA[tabla]
  if (!_encabezados[tabla]) leer(tabla)
  const encabezados = _encabezados[tabla].length ? _encabezados[tabla] : Object.keys(def)
  return encabezados.map((col, i) => {
    if (def[col]) return aCelda_(def[col], obj[col])
    return obj._crudo ? obj._crudo[i] : ''
  })
}

/** Inserta y devuelve el objeto completo (con los tipos normalizados, sin `_fila`). */
function insertar(tabla, obj) {
  const h = hoja_(tabla)
  const fila = filaDe_(tabla, obj)
  h.getRange(h.getLastRow() + 1, 1, 1, fila.length).setValues([fila])
  delete _tablas[tabla]
  return normalizar_(tabla, obj)
}

function insertarVarios(tabla, objs) {
  if (objs.length === 0) return []
  const h = hoja_(tabla)
  const filas = objs.map((o) => filaDe_(tabla, o))
  h.getRange(h.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas)
  delete _tablas[tabla]
  return objs.map((o) => normalizar_(tabla, o))
}

/** Aplica `cambios` a la fila con ese id. Devuelve el objeto actualizado o null si no existe. */
function actualizar(tabla, id, cambios) {
  const actual = porId(tabla, id)
  if (!actual) return null
  const nuevo = Object.assign({}, actual, cambios, { id: actual.id })
  const fila = filaDe_(tabla, nuevo)
  hoja_(tabla).getRange(actual._fila, 1, 1, fila.length).setValues([fila])
  delete _tablas[tabla]
  return normalizar_(tabla, nuevo)
}

/** Borra todas las filas que cumplen el filtro. Devuelve cuantas. */
function borrar(tabla, filtro) {
  const filas = leer(tabla).filter(filtro).map((f) => f._fila)
  if (filas.length === 0) return 0
  const h = hoja_(tabla)
  // De abajo hacia arriba: borrar una fila corre las de abajo una posicion.
  filas.sort((a, b) => b - a).forEach((n) => h.deleteRow(n))
  delete _tablas[tabla]
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
  if (!lock.tryLock(20000)) throw new ErrorApp(503, 'El servidor está ocupado. Intentá de nuevo en unos segundos.')
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}
