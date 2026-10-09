import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { invalidarResumenes } from '@/hooks/useProyectos'
import * as datosApi from '@/lib/datos'
import { mensajeDe } from '@/lib/errores'
import { alResetearRecursos } from '@/lib/recurso'
import { ordenEntre, tareasDeSeccion } from '@/lib/tareas'
import type { CambiosTarea, DatosProyecto, Proyecto, Tarea } from '@/lib/tipos'

/**
 * Todo lo de UN proyecto (secciones, tareas, etiquetas, miembros), cacheado
 * en memoria por id, con la misma idea que `crearRecurso`: al volver a un
 * proyecto se ve lo ultimo al instante y se revalida por detras.
 *
 * Las ediciones son OPTIMISTAS: se aplican en pantalla al toque y despues
 * se mandan a Apps Script (que tarda ~1 s). Si el servidor rechaza, se
 * avisa con un toast y se vuelve a pedir el proyecto entero para que la
 * pantalla quede igual que el Sheet.
 */

interface Estado {
  datos: DatosProyecto | null
  loading: boolean
  error: string | null
  cargadoEn: number | null
}

const INICIAL: Estado = { datos: null, loading: true, error: null, cargadoEn: null }
const FRESCO_MS = 15_000

const estados = new Map<string, Estado>()
const enCurso = new Map<string, Promise<void>>()
const suscriptores = new Set<() => void>()
let generacion = 0

alResetearRecursos(() => {
  generacion++
  estados.clear()
  enCurso.clear()
  suscriptores.forEach((f) => f())
})

function get(id: string): Estado {
  return estados.get(id) ?? INICIAL
}

function set(id: string, parcial: Partial<Estado>) {
  estados.set(id, { ...get(id), ...parcial })
  suscriptores.forEach((f) => f())
}

function mutarDatos(id: string, fn: (d: DatosProyecto) => DatosProyecto) {
  const actual = get(id).datos
  if (actual) set(id, { datos: fn(actual) })
}

function cargar(id: string): Promise<void> {
  const ya = enCurso.get(id)
  if (ya) return ya
  const gen = generacion
  if (!get(id).cargadoEn) set(id, { loading: true, error: null })
  const p = (async () => {
    try {
      const datos: DatosProyecto = await datosApi.cargarProyecto(id)
      if (gen !== generacion) return
      set(id, { datos, loading: false, error: null, cargadoEn: Date.now() })
    } catch (e) {
      if (gen !== generacion) return
      set(id, { loading: false, error: mensajeDe(e, 'No se pudo cargar el proyecto.') })
    } finally {
      enCurso.delete(id)
    }
  })()
  enCurso.set(id, p)
  return p
}

function suscribir(f: () => void) {
  suscriptores.add(f)
  return () => {
    suscriptores.delete(f)
  }
}

/** Ids temporales de lo creado en forma optimista, hasta que vuelve el id real del servidor. */
export const esTemporal = (id: string) => id.startsWith('tmp-')
const idTemporal = () => `tmp-${Math.random().toString(36).slice(2)}`

export function useProyecto(id: string) {
  const estado = useSyncExternalStore(suscribir, () => get(id))

  useEffect(() => {
    const e = get(id)
    if (!e.cargadoEn || Date.now() - e.cargadoEn > FRESCO_MS) cargar(id)
  }, [id])

  const refetch = useCallback(() => cargar(id), [id])

  /** Corre la escritura; si falla, avisa y recarga el proyecto desde el servidor. */
  const escribir = useCallback(
    async <T,>(fn: () => Promise<T>, mensajeError: string): Promise<T | null> => {
      try {
        const r = await fn()
        invalidarResumenes()
        return r
      } catch (e) {
        toast.error(mensajeDe(e, mensajeError))
        cargar(id)
        return null
      }
    },
    [id],
  )

  // ── Tareas ──────────────────────────────────────────────────────────────

  const crearTarea = useCallback(
    async (datos: { seccion_id: string; titulo: string; parent_id?: string | null; al_principio?: boolean } & CambiosTarea) => {
      const d = get(id).datos
      if (!d) return null
      const { al_principio, ...resto } = datos
      // El orden se calcula aca para que la tarjeta optimista y la real queden en el mismo lugar.
      const hermanas = resto.parent_id
        ? d.tareas.filter((t) => t.parent_id === resto.parent_id).sort((a, b) => a.orden - b.orden)
        : tareasDeSeccion(d.tareas, resto.seccion_id)
      const orden = al_principio
        ? ordenEntre(undefined, hermanas[0]?.orden)
        : ordenEntre(hermanas[hermanas.length - 1]?.orden, undefined)
      const ahora = new Date().toISOString()
      const temporal: Tarea = {
        id: idTemporal(),
        proyecto_id: id,
        parent_id: null,
        descripcion: '',
        responsable_id: null,
        fecha_inicio: null,
        fecha_vencimiento: null,
        prioridad: null,
        etiquetas: [],
        completada: false,
        completada_en: null,
        creado_por: '',
        creado_en: ahora,
        actualizado_en: ahora,
        ...resto,
        orden,
      }
      mutarDatos(id, (x) => ({ ...x, tareas: [...x.tareas, temporal] }))
      const real = await escribir(
        () => datosApi.crearTarea({ ...resto, orden, proyecto_id: id }),
        'No se pudo crear la tarea.',
      )
      mutarDatos(id, (x) => ({
        ...x,
        tareas: real
          ? x.tareas.map((t) => (t.id === temporal.id ? real : t))
          : x.tareas.filter((t) => t.id !== temporal.id),
      }))
      return real
    },
    [id, escribir],
  )

  const editarTarea = useCallback(
    async (tareaId: string, cambios: CambiosTarea) => {
      if (esTemporal(tareaId)) return
      const d = get(id).datos
      const original = d?.tareas.find((t) => t.id === tareaId)
      if (!original) return
      const optimista: Partial<Tarea> = { ...cambios }
      if (cambios.completada !== undefined) {
        optimista.completada_en = cambios.completada ? new Date().toISOString() : null
      }
      mutarDatos(id, (x) => ({
        ...x,
        tareas: x.tareas.map((t) => {
          if (t.id === tareaId) return { ...t, ...optimista }
          // Mover una tarea principal arrastra sus subtareas (igual que el servidor).
          if (cambios.seccion_id && t.parent_id === tareaId) return { ...t, seccion_id: cambios.seccion_id }
          return t
        }),
      }))
      const real = await escribir(
        () => datosApi.editarTarea(tareaId, cambios),
        'No se pudo guardar la tarea.',
      )
      if (real) mutarDatos(id, (x) => ({ ...x, tareas: x.tareas.map((t) => (t.id === real.id ? real : t)) }))
    },
    [id, escribir],
  )

  const eliminarTarea = useCallback(
    async (tareaId: string) => {
      mutarDatos(id, (x) => ({ ...x, tareas: x.tareas.filter((t) => t.id !== tareaId && t.parent_id !== tareaId) }))
      await escribir(() => datosApi.eliminarTarea(tareaId), 'No se pudo eliminar la tarea.')
    },
    [id, escribir],
  )

  // ── Secciones ───────────────────────────────────────────────────────────

  const crearSeccion = useCallback(
    async (nombre: string) => {
      // Va al final: un orden mayor que el de todas las demas.
      const orden = (get(id).datos?.secciones ?? []).reduce((max, x) => Math.max(max, x.orden), 0) + 1
      const s = await escribir(() => datosApi.crearSeccion(id, nombre, orden), 'No se pudo crear la sección.')
      if (s) mutarDatos(id, (x) => ({ ...x, secciones: [...x.secciones, s] }))
      return s
    },
    [id, escribir],
  )

  const editarSeccion = useCallback(
    async (seccionId: string, cambios: { nombre?: string; orden?: number }) => {
      mutarDatos(id, (x) => ({ ...x, secciones: x.secciones.map((s) => (s.id === seccionId ? { ...s, ...cambios } : s)) }))
      await escribir(() => datosApi.editarSeccion(seccionId, cambios), 'No se pudo guardar la sección.')
    },
    [id, escribir],
  )

  const eliminarSeccion = useCallback(
    async (seccionId: string, moverA?: string) => {
      const ok = await escribir(
        () => datosApi.eliminarSeccion(seccionId, moverA),
        'No se pudo eliminar la sección.',
      )
      // Mover las tareas cambia sus ordenes: mas simple traer el proyecto de nuevo.
      if (ok !== null) await cargar(id)
    },
    [id, escribir],
  )

  // ── Etiquetas ───────────────────────────────────────────────────────────

  const crearEtiqueta = useCallback(
    async (nombre: string, color: string) => {
      const e = await escribir(
        () => datosApi.crearEtiqueta(id, nombre, color),
        'No se pudo crear la etiqueta.',
      )
      if (e) mutarDatos(id, (x) => ({ ...x, etiquetas: [...x.etiquetas, e] }))
      return e
    },
    [id, escribir],
  )

  const eliminarEtiqueta = useCallback(
    async (etiquetaId: string) => {
      mutarDatos(id, (x) => ({
        ...x,
        etiquetas: x.etiquetas.filter((e) => e.id !== etiquetaId),
        tareas: x.tareas.map((t) =>
          t.etiquetas.includes(etiquetaId) ? { ...t, etiquetas: t.etiquetas.filter((e) => e !== etiquetaId) } : t,
        ),
      }))
      await escribir(() => datosApi.eliminarEtiqueta(etiquetaId), 'No se pudo eliminar la etiqueta.')
    },
    [id, escribir],
  )

  // ── Proyecto ────────────────────────────────────────────────────────────

  /** Para editar/archivar/miembros: el componente llama a la base y refleja el resultado aca. */
  const reflejarProyecto = useCallback(
    (cambios: Partial<Proyecto>) => mutarDatos(id, (x) => ({ ...x, proyecto: { ...x.proyecto, ...cambios } })),
    [id],
  )

  return {
    ...estado,
    refetch,
    crearTarea,
    editarTarea,
    eliminarTarea,
    crearSeccion,
    editarSeccion,
    eliminarSeccion,
    crearEtiqueta,
    eliminarEtiqueta,
    reflejarProyecto,
  }
}

export type AccionesProyecto = ReturnType<typeof useProyecto>
