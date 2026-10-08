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
