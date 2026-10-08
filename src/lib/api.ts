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

/**
 * Llama a una accion del backend (`'tareas.crear'`, `'proyectos.cargar'`...).
 *
 * Va como POST text/plain a proposito: con application/json el navegador
 * haria un preflight OPTIONS que Apps Script no contesta, y fallaria por CORS.
 */
export async function gas<T>(accion: string, datos?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(URL_BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, token: leerToken(), datos: datos ?? {} }),
      redirect: 'follow',
    })
  } catch {
    throw new ErrorApi('No hay conexión con el servidor. Revisá tu internet.', 0)
  }

  let json: { ok: boolean; data?: T; error?: string; codigo?: number }
  try {
    json = await res.json()
  } catch {
    throw new ErrorApi(`Respuesta inválida del servidor (${res.status}).`, res.status)
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
