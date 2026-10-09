import { crearProyecto, listarProyectos, misTareas } from '@/lib/datos'
import { crearRecurso } from '@/lib/recurso'
import { supabase } from '@/lib/supabase'
import { hoyISO } from '@/lib/tareas'
import type { Proyecto, TareaMia } from '@/lib/tipos'

/** Proyectos de los que soy miembro, con su resumen de tareas. */
const proyectos = crearRecurso(() => listarProyectos(hoyISO()), 'No se pudieron cargar los proyectos.')

/** "Mis tareas": lo asignado a mi en todos mis proyectos activos (+ completadas recientes). */
const mias = crearRecurso(async () => {
  const { data } = await supabase.auth.getSession()
  return misTareas(data.session?.user.id ?? '')
}, 'No se pudieron cargar tus tareas.')

/** Llamar despues de tocar tareas: la lista de proyectos y "Mis tareas" se revalidan al volver a verse. */
export function invalidarResumenes() {
  proyectos.invalidar()
  mias.invalidar()
}

export function useProyectos() {
  const estado = proyectos.useRecurso()

  async function crear(datos: { nombre: string; descripcion: string; color: string; miembros: string[] }) {
    const p = await crearProyecto(datos)
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

export type { TareaMia }
