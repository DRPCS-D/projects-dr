import { Check } from 'lucide-react'
import { iniciales } from '@/lib/tareas'
import type { Usuario } from '@/lib/tipos'
import { cn } from '@/lib/utils'

const TAMANOS = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const

/** Circulo con las iniciales sobre el color de la persona. Sin usuario: un circulo punteado ("sin asignar"). */
export function Avatar({
  usuario,
  tamano = 'sm',
  className,
}: {
  usuario: Pick<Usuario, 'nombre' | 'color'> | null | undefined
  tamano?: keyof typeof TAMANOS
  className?: string
}) {
  if (!usuario) {
    return (
      <span
        className={cn('inline-flex shrink-0 rounded-full border border-dashed border-muted-foreground/50', TAMANOS[tamano], className)}
        title="Sin asignar"
      />
    )
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        TAMANOS[tamano],
        className,
      )}
      style={{ backgroundColor: usuario.color || '#64748b' }}
      title={usuario.nombre}
    >
      {iniciales(usuario.nombre)}
    </span>
  )
}

/** Varias caras superpuestas (+N si sobran), como en la cabecera de un proyecto de Basecamp. */
export function GrupoAvatares({
  usuarios,
  max = 5,
  tamano = 'sm',
}: {
  usuarios: Pick<Usuario, 'id' | 'nombre' | 'color'>[]
  max?: number
  tamano?: keyof typeof TAMANOS
}) {
  const visibles = usuarios.slice(0, max)
  const resto = usuarios.length - visibles.length
  return (
    <div className="flex -space-x-1.5">
      {visibles.map((u) => (
        <Avatar key={u.id} usuario={u} tamano={tamano} className="ring-2 ring-card" />
      ))}
      {resto > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-2 ring-card',
            TAMANOS[tamano],
          )}
        >
          +{resto}
        </span>
      )}
    </div>
  )
}

/** Fila de muestras de color para elegir uno. */
export function SelectorColor({
  colores,
  valor,
  onCambiar,
}: {
  colores: string[]
  valor: string
  onCambiar: (c: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colores.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onCambiar(c)}
          className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
          aria-pressed={valor === c}
        >
          {valor === c && <Check className="size-4 text-white" />}
        </button>
      ))}
    </div>
  )
}
