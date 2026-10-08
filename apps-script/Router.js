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
  resetearCacheDb()
  try {
    if (!req || typeof req !== 'object') throw new ErrorApp(400, 'Pedido inválido.')
    const tabla = acciones_()
    const accion = Object.prototype.hasOwnProperty.call(tabla, req.accion) ? tabla[req.accion] : null
    if (!accion) throw new ErrorApp(400, `Acción desconocida: ${req.accion}`)
    const datos = req.datos && typeof req.datos === 'object' ? req.datos : {}

    const ejecutar = () => {
      const ctx = { token: req.token, usuario: accion.publica ? null : usuarioDeToken(req.token) }
      return accion.fn(datos, ctx)
    }
    const data = accion.escribe ? conLock(ejecutar) : ejecutar()
    return { ok: true, data: data === undefined ? null : data }
  } catch (err) {
    if (err instanceof ErrorApp) return { ok: false, error: err.message, codigo: err.codigo }
    console.error(err && err.stack ? err.stack : err)
    return { ok: false, error: 'Error interno del servidor.', codigo: 500 }
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
