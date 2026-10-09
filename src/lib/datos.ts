/**
 * Acceso a los datos (Supabase). Unico lugar donde la app habla con la base:
 * los hooks y las pantallas llaman a estas funciones y no conocen PostgREST.
 *
 * Nada de aca decide permisos. Lo que cada persona puede leer o escribir lo
 * decide la RLS en Postgres (supabase/migrations/002_seguridad.sql): si un
 * pedido no corresponde, la base lo rechaza o devuelve cero filas.
 *
 * Todas lanzan `ErrorApp` con un mensaje listo para mostrar.
 */
import { aErrorApp, ErrorApp } from './errores'
import { traerTodo } from './recurso'
import { supabase } from './supabase'
import type {
  CambiosTarea,
  DatosProyecto,
  Etiqueta,
  Proyecto,
  ProyectoConResumen,
  Rol,
  Seccion,
  Tarea,
  TareaMia,
  Usuario,
} from './tipos'

/** Devuelve `data` o lanza el error de la respuesta de supabase-js ya traducido. */
function dato<T>(res: { data: T | null; error: unknown }, porDefecto?: string): T {
  if (res.error) throw aErrorApp(res.error, porDefecto)
  return res.data as T
}

/** Para escrituras sin resultado (rpc void): solo importa que no haya error. */
function sinDatos(res: { error: unknown }, porDefecto?: string): void {
  if (res.error) throw aErrorApp(res.error, porDefecto)
}

/** Un UPDATE/DELETE bloqueado por la RLS no da error: afecta cero filas. Eso es un "no". */
function exigeFila<T>(filas: T[] | null, mensaje: string): T[] {
  if (!filas || filas.length === 0) throw new ErrorApp(mensaje, 'PGRST116')
  return filas
}

// ── Usuarios ───────────────────────────────────────────────────────────────

const CAMPOS_USUARIO = 'id, nombre, email, rol, activo, color, creado_en'

export async function listarUsuarios(): Promise<Usuario[]> {
  return dato<Usuario[]>(await supabase.from('usuarios').select(CAMPOS_USUARIO).order('nombre'))
}

export async function miPerfil(id: string): Promise<Usuario | null> {
  const { data, error } = await supabase.from('usuarios').select(CAMPOS_USUARIO).eq('id', id).maybeSingle()
  if (error) throw aErrorApp(error, 'No se pudo cargar tu perfil.')
  return data as Usuario | null
}

/**
 * Alta, edicion, activar/desactivar y reseteo de contraseña: pasan por la Edge
 * Function `admin-usuarios` porque necesitan la clave privada de Supabase, que
 * nunca puede estar en el navegador. Solo responde a un admin.
 */
async function adminUsuarios<T>(accion: string, datos: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body: { accion, ...datos } })
  if (error) {
    // Con un status de error el cuerpo trae { error: 'mensaje en español' }.
    const respuesta = (error as { context?: Response }).context
    if (respuesta && typeof respuesta.json === 'function') {
      const cuerpo = await respuesta.json().catch(() => null)
      if (cuerpo && typeof cuerpo.error === 'string') throw new ErrorApp(cuerpo.error, respuesta.status)
    }
    if ((error as Error).name === 'FunctionsFetchError') throw aErrorApp({ message: 'Failed to fetch' })
    throw aErrorApp(error, 'No se pudo completar la operación.')
  }
  return data as T
}

export const crearUsuario = (d: { nombre: string; email: string; password: string; rol: Rol }) =>
  adminUsuarios<Usuario>('crear', d)

export const editarUsuario = (d: { id: string; nombre: string; email: string; rol?: Rol; color?: string }) =>
  adminUsuarios<Usuario>('editar', d)

export const setUsuarioActivo = (id: string, activo: boolean) => adminUsuarios<Usuario>('setActivo', { id, activo })

export const resetearPassword = (id: string, password: string) => adminUsuarios<{ ok: true }>('password', { id, password })

// ── Proyectos ──────────────────────────────────────────────────────────────

type FilaProyecto = Omit<Proyecto, 'miembros'> & { miembros: { usuario_id: string }[] }

const aProyecto = ({ miembros, ...p }: FilaProyecto): Proyecto => ({ ...p, miembros: miembros.map((m) => m.usuario_id) })

/** Proyectos de los que soy miembro, con su resumen. `hoy` ('YYYY-MM-DD') es el de quien mira. */
export async function listarProyectos(hoy: string): Promise<ProyectoConResumen[]> {
  const filas = dato<(Proyecto & { total: number; completadas: number; vencidas: number })[]>(
    await supabase.rpc('listar_proyectos', { hoy }),
    'No se pudieron cargar los proyectos.',
  )
  return filas.map(({ total, completadas, vencidas, ...p }) => ({ ...p, resumen: { total, completadas, vencidas } }))
}

/** Todo lo de la pantalla de un proyecto, en paralelo. */
export async function cargarProyecto(id: string): Promise<DatosProyecto> {
  const [proyecto, secciones, tareas, etiquetas] = await Promise.all([
    supabase.from('proyectos').select('*, miembros(usuario_id)').eq('id', id).maybeSingle(),
    supabase.from('secciones').select('*').eq('proyecto_id', id).order('orden'),
    traerTodo<Tarea>((d, h) => supabase.from('tareas').select('*').eq('proyecto_id', id).order('orden').order('id').range(d, h)),
    supabase.from('etiquetas').select('*').eq('proyecto_id', id).order('nombre'),
  ])
  if (proyecto.error) throw aErrorApp(proyecto.error, 'No se pudo cargar el proyecto.')
  // Un proyecto ajeno no se distingue de uno que no existe: la RLS no devuelve la fila.
  if (!proyecto.data) throw new ErrorApp('Proyecto no encontrado.', 'PGRST116')
  return {
    proyecto: aProyecto(proyecto.data as FilaProyecto),
    secciones: dato<Seccion[]>(secciones),
    tareas,
    etiquetas: dato<Etiqueta[]>(etiquetas),
  }
}

export async function crearProyecto(d: {
  nombre: string
  descripcion: string
  color: string
  miembros: string[]
}): Promise<ProyectoConResumen> {
  const id = dato<string>(
    await supabase.rpc('crear_proyecto', {
      p_nombre: d.nombre,
      p_descripcion: d.descripcion,
      p_color: d.color,
      p_miembros: d.miembros,
    }),
    'No se pudo crear el proyecto.',
  )
  const fila = dato<FilaProyecto>(await supabase.from('proyectos').select('*, miembros(usuario_id)').eq('id', id).single())
  return { ...aProyecto(fila), resumen: { total: 0, completadas: 0, vencidas: 0 } }
}

export async function editarProyecto(
  id: string,
  cambios: { nombre: string; descripcion: string; color: string },
): Promise<Proyecto> {
  const filas = dato<FilaProyecto[]>(
    await supabase.from('proyectos').update(cambios).eq('id', id).select('*, miembros(usuario_id)'),
    'No se pudo guardar el proyecto.',
  )
  return aProyecto(exigeFila(filas, 'No se pudo guardar el proyecto.')[0])
}

export async function archivarProyecto(id: string, archivado: boolean): Promise<Proyecto['estado']> {
  const estado = archivado ? 'archivado' : 'activo'
  const filas = dato<{ id: string }[]>(
    await supabase.from('proyectos').update({ estado }).eq('id', id).select('id'),
    'No se pudo actualizar el proyecto.',
  )
  exigeFila(filas, 'No se pudo actualizar el proyecto.')
  return estado
}

export async function guardarMiembros(proyectoId: string, usuarios: string[]): Promise<string[]> {
  return dato<string[]>(
    await supabase.rpc('guardar_miembros', { p_proyecto: proyectoId, p_usuarios: usuarios }),
    'No se pudo guardar el equipo.',
  )
}

export async function salirProyecto(proyectoId: string): Promise<void> {
  sinDatos(await supabase.rpc('salir_proyecto', { p_proyecto: proyectoId }), 'No se pudo salir del proyecto.')
}

export async function eliminarProyecto(id: string): Promise<void> {
  const filas = dato<{ id: string }[]>(
    await supabase.from('proyectos').delete().eq('id', id).select('id'),
    'No se pudo eliminar el proyecto.',
  )
  exigeFila(filas, 'No se pudo eliminar el proyecto.')
}

// ── Tareas ─────────────────────────────────────────────────────────────────

/** Columnas que el cliente puede mandar al crear (el resto lo fija la base). */
type NuevaTarea = {
  proyecto_id: string
  seccion_id: string
  parent_id?: string | null
  titulo: string
  orden: number
} & Pick<CambiosTarea, 'descripcion' | 'responsable_id' | 'fecha_inicio' | 'fecha_vencimiento' | 'prioridad' | 'etiquetas'>

export async function crearTarea(d: NuevaTarea): Promise<Tarea> {
  const { proyecto_id, seccion_id, parent_id, titulo, orden, descripcion, responsable_id, fecha_inicio, fecha_vencimiento, prioridad, etiquetas } = d
  return dato<Tarea>(
    await supabase
      .from('tareas')
      .insert({ proyecto_id, seccion_id, parent_id, titulo, orden, descripcion, responsable_id, fecha_inicio, fecha_vencimiento, prioridad, etiquetas })
      .select()
      .single(),
    'No se pudo crear la tarea.',
  )
}

export async function editarTarea(id: string, cambios: CambiosTarea): Promise<Tarea> {
  const filas = dato<Tarea[]>(
    await supabase.from('tareas').update(cambios).eq('id', id).select(),
    'No se pudo guardar la tarea.',
  )
  return exigeFila(filas, 'No se pudo guardar la tarea.')[0]
}

export async function eliminarTarea(id: string): Promise<void> {
  const filas = dato<{ id: string }[]>(
    await supabase.from('tareas').delete().eq('id', id).select('id'),
    'No se pudo eliminar la tarea.',
  )
  exigeFila(filas, 'No se pudo eliminar la tarea.')
}

/**
 * "Mis tareas": lo asignado a mi en proyectos activos de los que sigo siendo
 * miembro. Las completadas solo de los ultimos 14 dias, para no bajar el historial.
 */
export async function misTareas(usuarioId: string): Promise<TareaMia[]> {
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const filas = await traerTodo<Tarea & { proyecto: TareaMia['proyecto']; seccion: { nombre: string } | null }>((d, h) =>
    supabase
      .from('tareas')
      .select('*, proyecto:proyectos!inner(id, nombre, color, estado), seccion:secciones(nombre)')
      .eq('responsable_id', usuarioId)
      .eq('proyecto.estado', 'activo')
      .or(`completada.eq.false,completada_en.gte.${desde}`)
      .order('id')
      .range(d, h),
  )
  return filas.map(({ proyecto, seccion, ...t }) => ({
    ...t,
    proyecto: { id: proyecto.id, nombre: proyecto.nombre, color: proyecto.color },
    seccion_nombre: seccion?.nombre ?? '',
  }))
}

// ── Secciones y etiquetas ──────────────────────────────────────────────────

export async function crearSeccion(proyectoId: string, nombre: string, orden: number): Promise<Seccion> {
  return dato<Seccion>(
    await supabase.from('secciones').insert({ proyecto_id: proyectoId, nombre, orden }).select().single(),
    'No se pudo crear la sección.',
  )
}

export async function editarSeccion(id: string, cambios: { nombre?: string; orden?: number }): Promise<void> {
  const filas = dato<{ id: string }[]>(
    await supabase.from('secciones').update(cambios).eq('id', id).select('id'),
    'No se pudo guardar la sección.',
  )
  exigeFila(filas, 'No se pudo guardar la sección.')
}

/** Si la seccion tiene tareas hay que decir a donde pasan (`moverA`). */
export async function eliminarSeccion(id: string, moverA?: string): Promise<void> {
  sinDatos(
    await supabase.rpc('eliminar_seccion', { p_seccion: id, p_mover_a: moverA ?? null }),
    'No se pudo eliminar la sección.',
  )
}

export async function crearEtiqueta(proyectoId: string, nombre: string, color: string): Promise<Etiqueta> {
  return dato<Etiqueta>(
    await supabase.from('etiquetas').insert({ proyecto_id: proyectoId, nombre, color }).select().single(),
    'No se pudo crear la etiqueta.',
  )
}

export async function eliminarEtiqueta(id: string): Promise<void> {
  const filas = dato<{ id: string }[]>(
    await supabase.from('etiquetas').delete().eq('id', id).select('id'),
    'No se pudo eliminar la etiqueta.',
  )
  exigeFila(filas, 'No se pudo eliminar la etiqueta.')
}
