import { claveLocal } from '@/lib/app'

/**
 * Cliente del backend de Apps Script.
 *
 * Con `VITE_GAS_URL` en `.env` se habla con la Web App desplegada; sin ella,
 * con el backend local que levanta `npm run dev` en `/gas-local` (el mismo
 * codigo de apps-script/, sobre un Sheet en memoria; ver vite.config.ts).
 */
const GAS_URL = (import.meta.env.VITE_GAS_URL as string | undefined) || ''
export const URL_BACKEND = GAS_URL || '/gas-local'

/** En un build de produccion sin VITE_GAS_URL no hay backend: el login lo avisa. */
export const backendConfigurado = Boolean(GAS_URL) || import.meta.env.DEV

const CLAVE_TOKEN = claveLocal('sesion')

export function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN)
  } catch {
    return null
  }
}

export function guardarToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(CLAVE_TOKEN, token)
    else localStorage.removeItem(CLAVE_TOKEN)
  } catch {
    // Sin localStorage la sesion dura lo que la pestana.
  }
}

export class ErrorApi extends Error {
  codigo: number
  constructor(mensaje: string, codigo: number) {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Lo llama useAuth: cuando el backend contesta 401, se cierra la sesion en toda la app. */
let alExpirarSesion: (() => void) | null = null
export function onSesionExpirada(fn: (() => void) | null): void {
  alExpirarSesion = fn
}

/** Codigo de ErrorApi para "no se pudo hablar con el servidor" (sin respuesta, cortada o ilegible). */
export const SIN_CONEXION = 0

/**
 * Acciones que solo leen: si fallan por la red se reintentan solas. Las de
 * escritura NO, porque si la primera llego a procesarse el reintento
 * duplicaria la tarea/proyecto; ahi se avisa y el hook recarga lo real.
 */
const LECTURAS = new Set(['auth.yo', 'usuarios.listar', 'proyectos.listar', 'proyectos.cargar', 'tareas.mias'])
const ESPERAS_REINTENTO_MS = [800, 2500]
const MAX_REINTENTOS_OCUPADO = 2
/** Apps Script tiene picos de 10-35 s (arranque en frio): mas que esto ya es un fallo. */
const TIMEOUT_MS = 60_000

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Respuesta<T> = { ok: boolean; data?: T; error?: string; codigo?: number }

async function pedir<T>(accion: string, datos: unknown): Promise<Respuesta<T>> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(URL_BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, token: leerToken(), datos: datos ?? {} }),
      redirect: 'follow',
      signal: ctl.signal,
    })
    // Cuando Google devuelve una pagina de error propia (limite de
    // peticiones, fallo momentaneo) no trae JSON ni cabeceras CORS: el
    // navegador lo reporta como "Failed to fetch" y llega al catch de abajo.
    return await res.json()
  } catch (e) {
    const cortada = e instanceof DOMException && e.name === 'AbortError'
    throw new ErrorApi(
      cortada
        ? 'El servidor tardó demasiado en responder. Probá de nuevo.'
        : 'No se pudo conectar con el servidor. Revisá tu internet y probá de nuevo.',
      SIN_CONEXION,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Llama a una accion del backend (`'tareas.crear'`, `'proyectos.cargar'`...).
 *
 * Va como POST text/plain a proposito: con application/json el navegador
 * haria un preflight OPTIONS que Apps Script no contesta, y fallaria por CORS.
 */
export async function gas<T>(accion: string, datos?: unknown): Promise<T> {
  // Fallos de red: solo se reintentan las lecturas (ver LECTURAS).
  const reintentosRed = LECTURAS.has(accion) ? ESPERAS_REINTENTO_MS : []
  // 503 = el servidor no consiguio el candado de escritura y NO ejecuto la
  // accion, asi que reintentar es seguro tambien para las escrituras.
  let reintentosOcupado = 0
  let json: Respuesta<T>
  for (let intentoRed = 0; ; ) {
    try {
      json = await pedir<T>(accion, datos)
    } catch (e) {
      if (intentoRed >= reintentosRed.length) throw e
      await dormir(reintentosRed[intentoRed++])
      continue
    }
    if (!json.ok && json.codigo === 503 && reintentosOcupado < MAX_REINTENTOS_OCUPADO) {
      await dormir(1500 * ++reintentosOcupado)
      continue
    }
    break
  }

  if (!json.ok) {
    const codigo = json.codigo ?? 500
    if (codigo === 401 && accion !== 'auth.login') {
      guardarToken(null)
      alExpirarSesion?.()
    }
    throw new ErrorApi(json.error || 'Error del servidor.', codigo)
  }
  return json.data as T
}

/** Mensaje legible de cualquier error, para un toast o un ErrorBox. */
export function mensajeDe(e: unknown, porDefecto = 'Ocurrió un error.'): string {
  return e instanceof Error && e.message ? e.message : porDefecto
}
