import { Calendar, Check, Flag, Plus } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { estadoVencimiento, fechaCorta } from '@/lib/tareas'
import { PRIORIDAD_LABEL, type Etiqueta, type Prioridad, type Tarea } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/** Circulo para completar/reabrir, como el check de Asana. */
export function CheckTarea({
  completada,
  onCambiar,
  tamano = 'md',
  disabled,
}: {
  completada: boolean
  onCambiar: (v: boolean) => void
  tamano?: 'sm' | 'md'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onCambiar(!completada)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={completada ? 'Marcar como pendiente' : 'Marcar como completada'}
      aria-pressed={completada}
      className={cn(
        'group/check flex shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        tamano === 'sm' ? 'size-4' : 'size-5',
        completada
          ? 'border-success bg-success text-success-foreground'
          : 'border-muted-foreground/50 text-transparent hover:border-success hover:text-success',
      )}
    >
      <Check className={tamano === 'sm' ? 'size-2.5' : 'size-3'} strokeWidth={3} />
    </button>
  )
}

const TONO_FECHA = {
  vencida: 'text-destructive',
  hoy: 'text-warning font-medium',
  pronto: 'text-foreground',
  normal: 'text-muted-foreground',
} as const

export function FechaTarea({ tarea, className }: { tarea: Pick<Tarea, 'fecha_vencimiento' | 'completada'>; className?: string }) {
  if (!tarea.fecha_vencimiento) return null
  const estado = estadoVencimiento(tarea)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        estado ? TONO_FECHA[estado] : 'text-muted-foreground',
        className,
      )}
    >
      <Calendar className="size-3" />
      {fechaCorta(tarea.fecha_vencimiento)}
    </span>
  )
}

const TONO_PRIORIDAD: Record<Prioridad, string> = {
  alta: 'text-destructive',
  media: 'text-warning',
  baja: 'text-muted-foreground',
}

export function PrioridadIcono({ prioridad }: { prioridad: Prioridad | null }) {
  if (!prioridad) return null
  return (
    <span className={cn('inline-flex items-center', TONO_PRIORIDAD[prioridad])} title={`Prioridad ${PRIORIDAD_LABEL[prioridad].toLowerCase()}`}>
      <Flag className="size-3" fill="currentColor" />
    </span>
  )
}

export function EtiquetaChip({ etiqueta, className }: { etiqueta: Etiqueta; className?: string }) {
  return (
    <span
      className={cn('inline-flex max-w-32 items-center truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-none', className)}
      style={{ backgroundColor: `${etiqueta.color}22`, color: etiqueta.color }}
    >
      {etiqueta.nombre}
    </span>
  )
}

/**
 * "+ Agregar tarea" que se convierte en un input. Enter crea y deja el
 * input abierto para cargar varias seguidas (como Trello); Escape cierra.
 */
export function AgregarInline({
  texto = 'Agregar tarea',
  placeholder = 'Título de la tarea…',
  onCrear,
  className,
}: {
  texto?: string
  placeholder?: string
  onCrear: (titulo: string) => void
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [valor, setValor] = useState('')

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const t = valor.trim()
      if (t) onCrear(t)
      setValor('')
    } else if (e.key === 'Escape') {
      setValor('')
      setAbierto(false)
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        <Plus className="size-4" /> {texto}
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => {
        const t = valor.trim()
        if (t) onCrear(t)
        setValor('')
        setAbierto(false)
      }}
      placeholder={placeholder}
      className={cn(
        'h-9 w-full rounded-md border border-primary bg-card px-3 text-sm text-foreground shadow-xs outline-none ring-2 ring-ring/30 placeholder:text-muted-foreground',
        className,
      )}
    />
  )
}
