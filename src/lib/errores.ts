/**
 * Errores del backend (Supabase) convertidos a mensajes para la persona.
 *
 * Los errores que levanta la propia base con `raise exception` ya vienen en
 * español y dicen que paso ("Elegí a qué sección pasan sus tareas."): se
 * muestran tal cual. Los tecnicos de Postgres/PostgREST se traducen.
 */

/** Error de la app con su codigo (el de Postgres/PostgREST o un HTTP). */
export class ErrorApp extends Error {
  codigo: string | number

  constructor(mensaje: string, codigo: string | number = '') {
    super(mensaje)
    this.codigo = codigo
  }
}

/** Codigos de Postgres/PostgREST que NO traen un mensaje util para la persona. */
const TRADUCIDOS: Record<string, string> = {
  '42501': 'No tenés permiso para hacer eso.',
  '23505': 'Ya existe un registro con esos datos.',
  '23503': 'No se puede completar: hay datos que dependen de esto.',
  PGRST116: 'No se encontró lo que buscabas. Quizás ya no existe o no tenés acceso.',
  PGRST301: 'Tu sesión expiró. Volvé a iniciar sesión.',
  PGRST303: 'Tu sesión expiró. Volvé a iniciar sesión.',
}

const SIN_CONEXION = 'No se pudo conectar con el servidor. Revisá tu internet y probá de nuevo.'

/** El error de supabase-js (PostgrestError, AuthError...) o de fetch → ErrorApp. */
export function aErrorApp(e: unknown, porDefecto = 'Ocurrió un error.'): ErrorApp {
  if (e instanceof ErrorApp) return e
  const obj = (typeof e === 'object' && e !== null ? e : {}) as { message?: unknown; code?: unknown; status?: unknown }
  const mensaje = typeof obj.message === 'string' ? obj.message : ''
  const codigo = typeof obj.code === 'string' ? obj.code : typeof obj.status === 'number' ? obj.status : ''

  if (/failed to fetch|networkerror|load failed|network request failed/i.test(mensaje)) {
    return new ErrorApp(SIN_CONEXION, 'sin-conexion')
  }
  if (typeof codigo === 'string' && TRADUCIDOS[codigo]) return new ErrorApp(TRADUCIDOS[codigo], codigo)
  // Los `raise exception` propios (22023, P0002, P0001) y las respuestas de la
  // Edge Function ya traen un mensaje en español pensado para mostrarse.
  if (mensaje) return new ErrorApp(mensaje, codigo)
  return new ErrorApp(porDefecto, codigo)
}

/** Mensaje legible de cualquier error, para un toast o un ErrorBox. */
export function mensajeDe(e: unknown, porDefecto = 'Ocurrió un error.'): string {
  return aErrorApp(e, porDefecto).message
}

/** true si el fallo fue de red / servidor inalcanzable (no una respuesta del servidor). */
export function esSinConexion(e: unknown): boolean {
  return aErrorApp(e).codigo === 'sin-conexion'
}
