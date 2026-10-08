/**
 * Tareas, secciones y etiquetas de un proyecto.
 *
 * Secciones = listas (vista Lista) = columnas (vista Tablero), como en Asana:
 * una sola fuente de verdad para las dos vistas.
 *
 * `orden` es fraccionario: mover una tarjeta entre otras dos le pone el
 * promedio de sus ordenes (lo calcula el cliente), asi un drag & drop
 * escribe UNA fila en vez de renumerar toda la columna.
 */

const PRIORIDADES = ['baja', 'media', 'alta']
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function fechaOpcional_(v, campo) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  if (!FECHA_RE.test(s)) throw new ErrorApp(400, `La fecha "${campo}" no es válida.`)
  return s
}

function exigeTarea_(id, usuario) {
  const t = porId('Tareas', id)
  if (!t) throw new ErrorApp(404, 'Tarea no encontrada.')
  exigeMiembro(t.proyecto_id, usuario)
  return t
}

function exigeSeccionDe_(seccionId, proyectoId) {
  const s = porId('Secciones', seccionId)
  if (!s || s.proyecto_id !== proyectoId) throw new ErrorApp(400, 'La sección no pertenece al proyecto.')
  return s
}

/**
 * Valida y normaliza los campos editables de una tarea. Solo procesa los que
 * vienen en `datos` (para editar de a un campo).
 */
function camposTarea_(datos, proyectoId) {
  const out = {}
  if (datos.titulo !== undefined) {
    out.titulo = String(datos.titulo || '').trim()
    if (!out.titulo) throw new ErrorApp(400, 'El título es obligatorio.')
  }
  if (datos.descripcion !== undefined) out.descripcion = String(datos.descripcion || '')
  if (datos.responsable_id !== undefined) {
    const r = datos.responsable_id || null
    if (r && !esMiembro(proyectoId, r)) throw new ErrorApp(400, 'El responsable tiene que ser miembro del proyecto.')
    out.responsable_id = r
  }
  if (datos.fecha_inicio !== undefined) out.fecha_inicio = fechaOpcional_(datos.fecha_inicio, 'inicio')
  if (datos.fecha_vencimiento !== undefined) out.fecha_vencimiento = fechaOpcional_(datos.fecha_vencimiento, 'vencimiento')
  if (datos.prioridad !== undefined) {
    const p = datos.prioridad || null
    if (p && PRIORIDADES.indexOf(p) === -1) throw new ErrorApp(400, 'Prioridad inválida.')
    out.prioridad = p
  }
  if (datos.etiquetas !== undefined) {
    const validas = new Set(buscar('Etiquetas', (e) => e.proyecto_id === proyectoId).map((e) => e.id))
    out.etiquetas = [...new Set(datos.etiquetas || [])].filter((id) => validas.has(id))
  }
  if (datos.seccion_id !== undefined) out.seccion_id = exigeSeccionDe_(datos.seccion_id, proyectoId).id
  if (datos.orden !== undefined) {
    const o = Number(datos.orden)
    if (!isFinite(o)) throw new ErrorApp(400, 'Orden inválido.')
    out.orden = o
  }
  if (datos.completada !== undefined) {
    out.completada = datos.completada === true
    out.completada_en = out.completada ? ahora() : null
  }
  return out
}

// ── Tareas ────────────────────────────────────────────────────────────────

function tareasCrear(datos, ctx) {
  const proyecto = exigeMiembro(datos.proyecto_id, ctx.usuario)
  let padre = null
  if (datos.parent_id) {
    padre = porId('Tareas', datos.parent_id)
    if (!padre || padre.proyecto_id !== proyecto.id) throw new ErrorApp(400, 'La tarea principal no es de este proyecto.')
    if (padre.parent_id) throw new ErrorApp(400, 'Las subtareas no pueden tener subtareas.')
  }
  // Una subtarea vive en la seccion de su tarea principal.
  const seccionId = padre ? padre.seccion_id : datos.seccion_id
  exigeSeccionDe_(seccionId, proyecto.id)

  const campos = camposTarea_(
    Object.assign({ descripcion: '', etiquetas: [] }, datos, { completada: undefined, seccion_id: undefined, orden: undefined }),
    proyecto.id,
  )
  if (!campos.titulo) throw new ErrorApp(400, 'El título es obligatorio.')

  const hermanas = buscar('Tareas', (t) =>
    padre ? t.parent_id === padre.id : t.seccion_id === seccionId && !t.parent_id,
  )
  const orden = datos.orden !== undefined && isFinite(Number(datos.orden))
    ? Number(datos.orden)
    : hermanas.reduce((max, t) => Math.max(max, t.orden), 0) + 1

  const n = ahora()
  const t = insertar('Tareas', Object.assign(
    {
      id: uuid(),
      proyecto_id: proyecto.id,
      seccion_id: seccionId,
      parent_id: padre ? padre.id : null,
      responsable_id: null,
      fecha_inicio: null,
      fecha_vencimiento: null,
      prioridad: null,
      completada: false,
      completada_en: null,
      orden,
      creado_por: ctx.usuario.id,
      creado_en: n,
      actualizado_en: n,
    },
    campos,
  ))
  registrar(proyecto.id, ctx.usuario, 'creo', 'tarea', t.id, t.titulo)
  return t
}

function tareasEditar(datos, ctx) {
  const t = exigeTarea_(datos.id, ctx.usuario)
  const campos = camposTarea_(Object.assign({}, datos, { id: undefined }), t.proyecto_id)
  delete campos.id
  // Una subtarea no se mueve de seccion por su cuenta: sigue a su principal.
  if (t.parent_id) delete campos.seccion_id
  campos.actualizado_en = ahora()
  const nueva = actualizar('Tareas', t.id, campos)

  // Mover una tarea principal arrastra sus subtareas a la misma seccion.
  if (!t.parent_id && campos.seccion_id && campos.seccion_id !== t.seccion_id) {
    buscar('Tareas', (s) => s.parent_id === t.id).forEach((s) => {
      actualizar('Tareas', s.id, { seccion_id: campos.seccion_id })
    })
  }
  if (campos.completada !== undefined && campos.completada !== t.completada) {
    registrar(t.proyecto_id, ctx.usuario, campos.completada ? 'completo' : 'reabrio', 'tarea', t.id, t.titulo)
  } else if (campos.seccion_id && campos.seccion_id !== t.seccion_id) {
    const s = porId('Secciones', campos.seccion_id)
    registrar(t.proyecto_id, ctx.usuario, 'movio', 'tarea', t.id, `${t.titulo} → ${s ? s.nombre : ''}`)
  }
  return nueva
}

function tareasEliminar(datos, ctx) {
  const t = exigeTarea_(datos.id, ctx.usuario)
  borrar('Tareas', (x) => x.id === t.id || x.parent_id === t.id)
  registrar(t.proyecto_id, ctx.usuario, 'elimino', 'tarea', t.id, t.titulo)
  return true
}

/**
 * "Mis tareas" (Asana): lo asignado a mi en todos los proyectos activos de
 * los que sigo siendo miembro. Las completadas solo si se piden, y solo las
 * de los ultimos 14 dias (para no bajar el historial entero).
 */
function tareasMias(datos, ctx) {
  const yo = ctx.usuario.id
  const mios = new Set(buscar('Miembros', (m) => m.usuario_id === yo).map((m) => m.proyecto_id))
  const proyectos = {}
  leer('Proyectos').forEach((p) => {
    if (mios.has(p.id) && p.estado === 'activo') proyectos[p.id] = { id: p.id, nombre: p.nombre, color: p.color }
  })
  const secciones = {}
  leer('Secciones').forEach((s) => { secciones[s.id] = s.nombre })
  const desde = new Date(Date.now() - 14 * 86400000).toISOString()
  return buscar('Tareas', (t) =>
    t.responsable_id === yo &&
    proyectos[t.proyecto_id] &&
    (!t.completada || (datos.incluirCompletadas && t.completada_en && t.completada_en >= desde)),
  ).map((t) => Object.assign(limpio(t), {
    proyecto: proyectos[t.proyecto_id],
    seccion_nombre: secciones[t.seccion_id] || '',
  }))
}

// ── Secciones ─────────────────────────────────────────────────────────────

function seccionesCrear(datos, ctx) {
  const p = exigeMiembro(datos.proyecto_id, ctx.usuario)
  const nombre = String(datos.nombre || '').trim()
  if (!nombre) throw new ErrorApp(400, 'El nombre de la sección es obligatorio.')
  const max = buscar('Secciones', (s) => s.proyecto_id === p.id).reduce((m, s) => Math.max(m, s.orden), 0)
  return insertar('Secciones', { id: uuid(), proyecto_id: p.id, nombre, orden: max + 1 })
}

function exigeSeccion_(id, usuario) {
  const s = porId('Secciones', id)
  if (!s) throw new ErrorApp(404, 'Sección no encontrada.')
  exigeMiembro(s.proyecto_id, usuario)
  return s
}

function seccionesEditar(datos, ctx) {
  exigeSeccion_(datos.id, ctx.usuario)
  const cambios = {}
  if (datos.nombre !== undefined) {
    cambios.nombre = String(datos.nombre || '').trim()
    if (!cambios.nombre) throw new ErrorApp(400, 'El nombre de la sección es obligatorio.')
  }
  if (datos.orden !== undefined) {
    if (!isFinite(Number(datos.orden))) throw new ErrorApp(400, 'Orden inválido.')
    cambios.orden = Number(datos.orden)
  }
  return limpio(actualizar('Secciones', datos.id, cambios))
}

/** Si la seccion tiene tareas, hay que decir a que otra seccion pasan (`mover_a`). */
function seccionesEliminar(datos, ctx) {
  const s = exigeSeccion_(datos.id, ctx.usuario)
  const delProyecto = buscar('Secciones', (x) => x.proyecto_id === s.proyecto_id)
  if (delProyecto.length <= 1) throw new ErrorApp(400, 'Un proyecto necesita al menos una sección.')
  const tareas = buscar('Tareas', (t) => t.seccion_id === s.id)
  if (tareas.length > 0) {
    if (!datos.mover_a || datos.mover_a === s.id) throw new ErrorApp(400, 'Elegí a qué sección pasan sus tareas.')
    const destino = exigeSeccionDe_(datos.mover_a, s.proyecto_id)
    let max = buscar('Tareas', (t) => t.seccion_id === destino.id && !t.parent_id).reduce((m, t) => Math.max(m, t.orden), 0)
    tareas.sort((a, b) => a.orden - b.orden).forEach((t) => {
      actualizar('Tareas', t.id, t.parent_id ? { seccion_id: destino.id } : { seccion_id: destino.id, orden: ++max })
    })
  }
  borrar('Secciones', (x) => x.id === s.id)
  return true
}

// ── Etiquetas ─────────────────────────────────────────────────────────────

function datosEtiqueta_(datos) {
  const nombre = String(datos.nombre || '').trim()
  if (!nombre) throw new ErrorApp(400, 'El nombre de la etiqueta es obligatorio.')
  return { nombre, color: String(datos.color || '#64748b') }
}

function exigeEtiqueta_(id, usuario) {
  const e = porId('Etiquetas', id)
  if (!e) throw new ErrorApp(404, 'Etiqueta no encontrada.')
  exigeMiembro(e.proyecto_id, usuario)
  return e
}

function etiquetasCrear(datos, ctx) {
  const p = exigeMiembro(datos.proyecto_id, ctx.usuario)
  return insertar('Etiquetas', Object.assign({ id: uuid(), proyecto_id: p.id }, datosEtiqueta_(datos)))
}

function etiquetasEditar(datos, ctx) {
  exigeEtiqueta_(datos.id, ctx.usuario)
  return limpio(actualizar('Etiquetas', datos.id, datosEtiqueta_(datos)))
}

function etiquetasEliminar(datos, ctx) {
  const e = exigeEtiqueta_(datos.id, ctx.usuario)
  buscar('Tareas', (t) => t.proyecto_id === e.proyecto_id && t.etiquetas.indexOf(e.id) !== -1).forEach((t) => {
    actualizar('Tareas', t.id, { etiquetas: t.etiquetas.filter((x) => x !== e.id) })
  })
  borrar('Etiquetas', (x) => x.id === e.id)
  return true
}
