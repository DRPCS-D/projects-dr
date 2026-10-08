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
