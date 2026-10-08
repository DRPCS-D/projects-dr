/** Logica pura de tareas: orden, fechas y agrupaciones. Sin React, para poder testearla. */
import type { Tarea } from './tipos'

/** 'YYYY-MM-DD' de hoy en la zona horaria del navegador (no en UTC). */
export function hoyISO(fecha = new Date()): string {
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${fecha.getFullYear()}-${m}-${d}`
}

export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return hoyISO(new Date(a, m - 1, d + dias))
}

/**
 * Orden para una tarjeta que queda entre `antes` y `despues` (cualquiera
 * puede faltar si va al principio o al final). Fraccionario: asi mover una
 * tarjeta escribe UNA fila, sin renumerar la columna entera.
 */
export function ordenEntre(antes: number | undefined, despues: number | undefined): number {
  if (antes === undefined && despues === undefined) return 1
  if (antes === undefined) return (despues as number) - 1
  if (despues === undefined) return antes + 1
  return (antes + despues) / 2
}

/** Tareas principales (no subtareas) de una seccion, ordenadas. */
export function tareasDeSeccion<T extends Tarea>(tareas: T[], seccionId: string): T[] {
  return tareas
    .filter((t) => t.seccion_id === seccionId && !t.parent_id)
    .sort((a, b) => a.orden - b.orden)
}

export function subtareasDe<T extends Tarea>(tareas: T[], tareaId: string): T[] {
  return tareas.filter((t) => t.parent_id === tareaId).sort((a, b) => a.orden - b.orden)
}

export type EstadoVencimiento = 'vencida' | 'hoy' | 'pronto' | 'normal' | null

/** Para pintar la fecha: vencida, hoy, en los proximos 3 dias, o mas adelante. */
export function estadoVencimiento(
  t: Pick<Tarea, 'fecha_vencimiento' | 'completada'>,
  hoy = hoyISO(),
): EstadoVencimiento {
  if (!t.fecha_vencimiento || t.completada) return null
  if (t.fecha_vencimiento < hoy) return 'vencida'
  if (t.fecha_vencimiento === hoy) return 'hoy'
  if (t.fecha_vencimiento <= sumarDias(hoy, 3)) return 'pronto'
  return 'normal'
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Fecha corta y relativa: Hoy, Mañana, Ayer, '8 oct' o '8 oct 2027' si es de otro año. */
export function fechaCorta(iso: string | null, hoy = hoyISO()): string {
  if (!iso) return ''
  if (iso === hoy) return 'Hoy'
  if (iso === sumarDias(hoy, 1)) return 'Mañana'
  if (iso === sumarDias(hoy, -1)) return 'Ayer'
  const [a, m, d] = iso.split('-').map(Number)
  const anio = a !== Number(hoy.slice(0, 4)) ? ` ${a}` : ''
  return `${d} ${MESES[m - 1]}${anio}`
}

export type GrupoMisTareas = 'vencidas' | 'hoy' | 'semana' | 'despues' | 'sin_fecha' | 'completadas'

export const GRUPOS_MIS_TAREAS: { id: GrupoMisTareas; titulo: string }[] = [
  { id: 'vencidas', titulo: 'Vencidas' },
  { id: 'hoy', titulo: 'Para hoy' },
  { id: 'semana', titulo: 'Próximos 7 días' },
  { id: 'despues', titulo: 'Más adelante' },
  { id: 'sin_fecha', titulo: 'Sin fecha' },
  { id: 'completadas', titulo: 'Completadas recientemente' },
]

export function grupoDe(t: Pick<Tarea, 'fecha_vencimiento' | 'completada'>, hoy = hoyISO()): GrupoMisTareas {
  if (t.completada) return 'completadas'
  const f = t.fecha_vencimiento
  if (!f) return 'sin_fecha'
  if (f < hoy) return 'vencidas'
  if (f === hoy) return 'hoy'
  if (f <= sumarDias(hoy, 7)) return 'semana'
  return 'despues'
}

/** Agrupa como "Mis tareas" de Asana; dentro de cada grupo, por fecha y despues por titulo. */
export function agruparMisTareas<T extends Tarea>(tareas: T[], hoy = hoyISO()): Record<GrupoMisTareas, T[]> {
  const grupos: Record<GrupoMisTareas, T[]> = {
    vencidas: [],
    hoy: [],
    semana: [],
    despues: [],
    sin_fecha: [],
    completadas: [],
  }
  for (const t of tareas) grupos[grupoDe(t, hoy)].push(t)
  const porFecha = (a: T, b: T) =>
    (a.fecha_vencimiento ?? '').localeCompare(b.fecha_vencimiento ?? '') || a.titulo.localeCompare(b.titulo, 'es')
  for (const g of Object.keys(grupos) as GrupoMisTareas[]) grupos[g].sort(porFecha)
  grupos.completadas.sort((a, b) => (b.completada_en ?? '').localeCompare(a.completada_en ?? ''))
  return grupos
}

/** Iniciales para el avatar: primer y ultimo nombre. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}
