import { ExternalLink, Link2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Textarea } from '@/components/ui/field'
import { extraerEnlaces, partirEnlaces } from '@/lib/enlaces'
import { cn } from '@/lib/utils'

const PLACEHOLDER = 'Detalles, criterios de terminado, enlaces…'
/** Cuantas tarjetas de enlace se muestran debajo del texto. */
const MAX_TARJETAS = 3

/** Caja sin bordes laterales: solo las lineas de arriba y abajo (ver TareaPanel). */
const CAJA = 'rounded-none border-x-0 px-0 shadow-none focus-visible:border-primary focus-visible:ring-0'

/**
 * Descripcion de una tarea, estilo WhatsApp: mientras se escribe es una caja de
 * texto comun; al salir, los enlaces se ven azules y clicables, y debajo
 * aparece una tarjeta por enlace. Un clic en el texto vuelve a editarlo.
 *
 * El texto se guarda tal cual lo escribio la persona: reconocer enlaces es solo
 * una forma de DIBUJARLO. Y se dibuja con elementos de React (nunca como HTML),
 * asi que un texto hostil no puede inyectar nada.
 */
export function DescripcionTarea({
  valor,
  original,
  onCambiar,
  onGuardar,
  disabled,
}: {
  valor: string
  /** Lo ultimo guardado: a esto vuelve Escape. */
  original: string
  onCambiar: (texto: string) => void
  /** Se llama al salir de la edicion. Quien la use decide si hay algo para guardar. */
  onGuardar: () => void
  disabled?: boolean
}) {
  const [editando, setEditando] = useState(false)
  const cancelado = useRef(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const partes = useMemo(() => partirEnlaces(valor), [valor])
  const enlaces = useMemo(() => extraerEnlaces(valor), [valor])

  // Al empezar a editar: foco y cursor al FINAL del texto (por defecto el
  // navegador lo deja al principio, y para agregar algo habria que ir hasta ahi).
  useEffect(() => {
    const area = areaRef.current
    if (!editando || !area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [editando])

  function empezar() {
    if (disabled) return
    // Seleccionar texto para copiarlo no debe abrir la edicion.
    if (window.getSelection()?.toString()) return
    // Una cancelacion anterior no puede afectar a esta edicion.
    cancelado.current = false
    setEditando(true)
  }

  function alSalir() {
    const fueCancelado = cancelado.current
    cancelado.current = false
    if (!fueCancelado) onGuardar()
    setEditando(false)
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Escape') return
    // Se sale directo, sin depender de que el navegador dispare el blur: solo
    // asi funciona aunque el campo no tenga el foco (y evita guardar el borrador).
    cancelado.current = true
    onCambiar(original)
    setEditando(false)
  }

  if (editando) {
    return (
      <Textarea
        ref={areaRef}
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        onBlur={alSalir}
        onKeyDown={alTeclear}
        rows={5}
        placeholder={PLACEHOLDER}
        className={cn('resize-y', CAJA)}
      />
    )
  }

  return (
    <div>
      {/* Sin role="button": adentro hay enlaces, y un boton no puede contener otros controles. */}
      <div
        tabIndex={disabled ? -1 : 0}
        aria-label="Descripción: clic para editar"
        onClick={empezar}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            empezar()
          }
        }}
        className={cn(
          'min-h-[8.25rem] whitespace-pre-wrap break-words border-y border-input py-2 text-sm leading-relaxed text-foreground outline-none transition-colors focus-visible:border-primary',
          disabled ? 'opacity-60' : 'cursor-text',
        )}
      >
        {valor ? (
          partes.map((p, i) =>
            p.url ? (
              <a
                key={i}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => e.stopPropagation()}
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                {p.texto}
              </a>
            ) : (
              <span key={i}>{p.texto}</span>
            ),
          )
        ) : (
          <span className="text-muted-foreground">{PLACEHOLDER}</span>
        )}
      </div>

      {enlaces.length > 0 && (
        <ul className="mt-3 space-y-2">
          {enlaces.slice(0, MAX_TARJETAS).map((e) => (
            <li key={e.url}>
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={e.url}
                className="flex items-center gap-3 rounded-lg border border-border bg-secondary/60 p-2.5 transition-colors hover:bg-accent"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Link2 className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{e.dominio}</span>
                  <span className="block truncate text-xs text-muted-foreground">{e.visible}</span>
                </span>
                <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
          {enlaces.length > MAX_TARJETAS && (
            <li className="px-1 text-xs text-muted-foreground">
              y {enlaces.length - MAX_TARJETAS} {enlaces.length - MAX_TARJETAS === 1 ? 'enlace más' : 'enlaces más'} en el texto
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
