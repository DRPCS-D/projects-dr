import { gas } from '@/lib/api'
import { crearRecurso } from '@/lib/recurso'
import { hoyISO } from '@/lib/tareas'
import type { Proyecto, ProyectoConResumen, TareaMia } from '@/lib/tipos'

/** Proyectos de los que soy miembro, con su resumen de tareas. */
const proyectos = crearRecurso(
  () => gas<ProyectoConResumen[]>('proyectos.listar', { hoy: hoyISO() }),
  'No se pudieron cargar los proyectos.',
)

/** "Mis tareas": lo asignado a mi en todos mis proyectos activos (+ completadas recientes). */
const mias = crearRecurso(
  () => gas<TareaMia[]>('tareas.mias', { incluirCompletadas: true }),
  'No se pudieron cargar tus tareas.',
)

/** Llamar despues de tocar tareas: la lista de proyectos y "Mis tareas" se revalidan al volver a verse. */
export function invalidarResumenes() {
  proyectos.invalidar()
  mias.invalidar()
}

export function useProyectos() {
  const estado = proyectos.useRecurso()

  async function crear(datos: { nombre: string; descripcion: string; color: string; miembros: string[] }) {
    const p = await gas<ProyectoConResumen>('proyectos.crear', datos)
    proyectos.mutar((d) => [p, ...d])
    return p
  }

  return { ...estado, crear }
}

/** Refleja en la lista un proyecto editado desde su pantalla, sin volver a pedirla. */
export function actualizarEnLista(id: string, cambios: Partial<Proyecto>) {
  proyectos.mutar((d) => d.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  mias.invalidar()
}

export function quitarDeLista(id: string) {
  proyectos.mutar((d) => d.filter((p) => p.id !== id))
  mias.invalidar()
}

export function useMisTareas() {
  return { ...mias.useRecurso(), mutar: mias.mutar }
}
