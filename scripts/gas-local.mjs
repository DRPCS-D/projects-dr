/**
 * Corre el backend de `apps-script/` en Node, con imitaciones en memoria de
 * los servicios de Google que usa (SpreadsheetApp, CacheService, LockService,
 * PropertiesService, Utilities, DriveApp, Session).
 *
 * Sirve para dos cosas:
 *  - los tests (`apps-script/tests/*.test.mjs`) prueban el backend REAL,
 *    incluidas las reglas de acceso, sin desplegar nada;
 *  - `npm run dev` sin `VITE_GAS_URL` levanta este backend en `/gas-local`
 *    (ver vite.config.ts) y guarda los datos en `.gas-local/db.json`, para
 *    desarrollar la interfaz sin tocar el Sheet de verdad.
 *
 * Solo imita lo que el backend usa: si se empieza a usar otro metodo de
 * Apps Script, hay que agregarlo aca o los tests van a fallar con
 * "is not a function" (que es lo correcto: avisa que falta imitarlo).
 */
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const DIR_GAS = path.resolve(import.meta.dirname, '../apps-script')

/** Bytes con signo (-128..127), como los devuelve Apps Script. */
const aFirmados = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b))
const aBuffer = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => (b + 256) % 256)))

function crearHoja(nombre, filas) {
  const datos = filas // matriz de strings, mutable
  const ancho = () => datos.reduce((m, f) => Math.max(m, f.length), 0)
  const hoja = {
    getName: () => nombre,
    getLastRow: () => datos.length,
    getLastColumn: () => ancho(),
    getMaxRows: () => Math.max(datos.length, 1000),
    getDataRange: () => ({
      getValues: () => datos.map((f) => Array.from({ length: ancho() }, (_, i) => f[i] ?? '')),
    }),
    getRange: (fila, col, nf = 1, nc = 1) => {
      const rango = {
        getValues: () =>
          Array.from({ length: nf }, (_, r) =>
            Array.from({ length: nc }, (_, c) => datos[fila - 1 + r]?.[col - 1 + c] ?? ''),
          ),
        setValues: (valores) => {
          valores.forEach((v, r) => {
            const idx = fila - 1 + r
            while (datos.length <= idx) datos.push([])
            v.forEach((celda, c) => {
              datos[idx][col - 1 + c] = celda instanceof Date ? celda.toISOString() : String(celda)
            })
          })
          return rango
        },
        setNumberFormat: () => rango,
        setFontWeight: () => rango,
      }
      return rango
    },
    deleteRow: (n) => {
      datos.splice(n - 1, 1)
    },
    setFrozenRows: () => {},
    _datos: datos,
  }
  return hoja
}

/**
 * @param {object} [estado] lo que devolvio `exportar()` de una corrida anterior.
 * @param {{ email?: string, fallarLock?: boolean, silencioso?: boolean, sinSheetsApi?: boolean }} [opciones]
 *   `sinSheetsApi`: como si el servicio avanzado de Sheets no estuviera habilitado.
 */
export function crearGasLocal(estado = {}, opciones = {}) {
  const hojas = new Map(Object.entries(estado.hojas ?? {}).map(([n, f]) => [n, crearHoja(n, f)]))
  const props = new Map(Object.entries(estado.props ?? {}))
  const cache = new Map() // clave -> { valor, vence }
  const libro = {
    getId: () => 'libro-local',
    getUrl: () => 'local://libro',
    getSheetByName: (n) => hojas.get(n) ?? null,
    insertSheet: (n) => {
      const h = crearHoja(n, [])
      hojas.set(n, h)
      return h
    },
    getSheets: () => [...hojas.values()],
    deleteSheet: (h) => hojas.delete(h.getName()),
  }

  const contexto = {
    console,
    Logger: { log: (...a) => opciones.silencioso || console.log('[gas]', ...a) },
    SpreadsheetApp: {
      openById: () => libro,
      create: () => libro,
      flush: () => {},
    },
    // Servicio avanzado de Sheets: como la API real, recorta las celdas
    // vacias del final de cada fila y las filas vacias del final.
    Sheets: opciones.sinSheetsApi
      ? undefined
      : {
          Spreadsheets: {
            Values: {
              batchGet: (_id, { ranges }) => ({
                valueRanges: ranges.map((r) => {
                  const nombre = r.replace(/^'|'$/g, '')
                  const h = hojas.get(nombre)
                  if (!h) throw new Error(`Unable to parse range: ${r}`)
                  const filas = h._datos.map((f) => {
                    const copia = f.map((c) => c ?? '')
                    while (copia.length && copia[copia.length - 1] === '') copia.pop()
                    return copia
                  })
                  while (filas.length && filas[filas.length - 1].length === 0) filas.pop()
                  return { range: `${nombre}!A1`, values: filas.length ? filas : undefined }
                }),
              }),
            },
          },
        },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, String(v)),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const e = cache.get(k)
          if (!e || e.vence < Date.now()) return null
          return e.valor
        },
        put: (k, v, seg = 600) => cache.set(k, { valor: String(v), vence: Date.now() + seg * 1000 }),
        remove: (k) => cache.delete(k),
        getAll: (claves) => {
          const out = {}
          for (const k of claves) {
            const e = cache.get(k)
            if (e && e.vence >= Date.now()) out[k] = e.valor
          }
          return out
        },
        putAll: (valores, seg = 600) => {
          for (const [k, v] of Object.entries(valores)) {
            if (String(v).length > 100 * 1024) throw new Error('Argumento demasiado grande: value')
            cache.set(k, { valor: String(v), vence: Date.now() + seg * 1000 })
          }
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !opciones.fallarLock, releaseLock: () => {} }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, valor) => aFirmados(createHash(alg).update(aBuffer(valor)).digest()),
      base64Encode: (bytes) => aBuffer(bytes).toString('base64'),
      newBlob: (s) => ({ getBytes: () => aFirmados(Buffer.from(s, 'utf8')) }),
      getUuid: () => randomUUID(),
    },
    DriveApp: {
      createFolder: () => ({ getId: () => 'carpeta-local' }),
      getFileById: () => ({ moveTo: () => {} }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => opciones.email ?? 'admin@local.test' }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ setMimeType: () => ({ contenido: t }) }),
    },
  }
  vm.createContext(contexto)
  for (const archivo of readdirSync(DIR_GAS).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(readFileSync(path.join(DIR_GAS, archivo), 'utf8'), contexto, { filename: archivo })
  }

  return {
    /** Mismo contrato que la Web App: recibe {accion, token, datos} y devuelve {ok, ...}. */
    manejar: (req) => JSON.parse(JSON.stringify(contexto.manejar(req))),
    setup: () => contexto.setup(),
    setProp: (k, v) => props.set(k, v),
    hoja: (n) => hojas.get(n)?._datos ?? null,
    /** Vacia el CacheService simulado (como si hubiera vencido todo). */
    vaciarCache: () => cache.clear(),
    exportar: () => ({
      hojas: Object.fromEntries([...hojas].map(([n, h]) => [n, h._datos])),
      props: Object.fromEntries(props),
    }),
  }
}
