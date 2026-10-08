/**
 * Tipos de las entidades tal como las devuelve el backend (apps-script/).
 *
 * Escritos a mano, espejo de `ESQUEMA` en `apps-script/Db.js`: si se agrega o
 * renombra una columna alla, hay que reflejarlo aca. Los campos opcionales
 * de la hoja (tipo `s?`) llegan como `null`, nunca como ''.
 */

export interface Usuario {
  id: string
  nombre: string
  email: string
  activo: boolean
  color: string
  creado_en: string
}

export type EstadoProyecto = 'activo' | 'archivado'

export interface Proyecto {
  id: string
  nombre: string
  descripcion: string
  color: string
  estado: EstadoProyecto
  drive_folder_id: string | null
  creado_por: string
  creado_en: string
  /** Ids de usuarios miembros. */
  miembros: string[]
}

export interface ResumenProyecto {
  total: number
  completadas: number
  vencidas: number
}

export interface ProyectoConResumen extends Proyecto {
  resumen: ResumenProyecto
}

export interface Seccion {
  id: string
  proyecto_id: string
  nombre: string
  orden: number
}

export type Prioridad = 'baja' | 'media' | 'alta'

export const PRIORIDAD_LABEL: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}

export interface Tarea {
  id: string
  proyecto_id: string
  seccion_id: string
  /** Si tiene, es una subtarea (un solo nivel). */
  parent_id: string | null
  titulo: string
  descripcion: string
  responsable_id: string | null
  /** 'YYYY-MM-DD' */
  fecha_inicio: string | null
  /** 'YYYY-MM-DD' */
  fecha_vencimiento: string | null
  prioridad: Prioridad | null
  /** Ids de etiquetas del proyecto. */
  etiquetas: string[]
  completada: boolean
  completada_en: string | null
  /** Fraccionario: entre dos tarjetas se usa el promedio. */
  orden: number
  creado_por: string
  creado_en: string
  actualizado_en: string
}

export interface Etiqueta {
  id: string
  proyecto_id: string
  nombre: string
  color: string
}

/** Lo que trae `proyectos.cargar`: todo lo de la pantalla de un proyecto. */
export interface DatosProyecto {
  proyecto: Proyecto
  secciones: Seccion[]
  tareas: Tarea[]
  etiquetas: Etiqueta[]
}

/** Item de "Mis tareas": la tarea con su proyecto ya resuelto. */
export interface TareaMia extends Tarea {
  proyecto: { id: string; nombre: string; color: string }
  seccion_nombre: string
}

/** Campos editables de una tarea (lo que acepta `tareas.editar`). */
export type CambiosTarea = Partial<
  Pick<
    Tarea,
    | 'titulo'
    | 'descripcion'
    | 'responsable_id'
    | 'fecha_inicio'
    | 'fecha_vencimiento'
    | 'prioridad'
    | 'etiquetas'
    | 'completada'
    | 'seccion_id'
    | 'orden'
  >
>

/** Paleta para proyectos y etiquetas. */
export const COLORES = [
  '#1659b5',
  '#0369a1',
  '#0f766e',
  '#4d7c0f',
  '#a16207',
  '#c2410c',
  '#be123c',
  '#7c3aed',
  '#64748b',
]
