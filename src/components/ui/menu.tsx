import { MoreHorizontal } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface OpcionMenu {
  label: string
  icono?: ComponentType<{ className?: string }>
  onClick: () => void
  peligro?: boolean
  oculto?: boolean
}

/**
 * Boton "…" con un menu de acciones. El menu va en un portal (como el
 * Combobox) para que no lo recorte el overflow de una columna del tablero.
 */
export function MenuAcciones({
  opciones,
  titulo = 'Más acciones',
  className,
}: {
  opciones: OpcionMenu[]
  titulo?: string
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!abierto) return
    const r = botonRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 192, window.innerWidth - 200)) })
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const cerrar = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !botonRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    const alScroll = () => setAbierto(false)
    document.addEventListener('mousedown', cerrar)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', alScroll, true)
    return () => {
      document.removeEventListener('mousedown', cerrar)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', alScroll, true)
    }
  }, [abierto])

  const visibles = opciones.filter((o) => !o.oculto)

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAbierto((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={titulo}
        aria-label={titulo}
        aria-expanded={abierto}
        className={cn(
          'rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {abierto &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[60] w-48 rounded-md border border-border bg-popover py-1 shadow-lg"
          >
            {visibles.map(({ label, icono: Icono, onClick, peligro }) => (
              <button
                key={label}
                role="menuitem"
                type="button"
                onClick={() => {
                  setAbierto(false)
                  onClick()
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent',
                  peligro ? 'text-destructive' : 'text-popover-foreground',
                )}
              >
                {Icono && <Icono className="size-4" />}
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
