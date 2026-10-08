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
