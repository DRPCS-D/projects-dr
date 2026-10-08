import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { esTemporal } from '@/hooks/useProyecto'
import { ordenEntre, tareasDeSeccion } from '@/lib/tareas'
import type { Tarea } from '@/lib/tipos'
import { cn } from '@/lib/utils'
import { AgregarInline, CheckTarea } from './comun'
import { AgregarSeccionInput, EncabezadoSeccion, MetaTarea, seccionesOrdenadas, type PropsVista } from './VistaLista'

const COL = 'col:'
type Columnas = Record<string, string[]>

function columnaDe(cols: Columnas, id: string): string | undefined {
  if (id.startsWith(COL)) return id.slice(COL.length)
  return Object.keys(cols).find((k) => cols[k].includes(id))
}

/**
 * Vista Tablero (Trello / Card Table de Basecamp): una columna por seccion,
 * tarjetas arrastrables entre columnas y dentro de una misma columna.
 *
 * Mientras se arrastra, el orden vive en un estado local (`arrastre`) para
 * que las tarjetas se acomoden en vivo; al soltar se calcula el orden
 * fraccionario entre los vecinos y se manda UNA edicion (optimista).
 */
export function VistaTablero({ datos, acciones, usuarios, filtro, onAbrir, onEliminarSeccion }: PropsVista) {
  const secciones = seccionesOrdenadas(datos.secciones)
  const porId = useMemo(() => new Map(datos.tareas.map((t) => [t.id, t])), [datos.tareas])

  const base = useMemo<Columnas>(
    () => Object.fromEntries(secciones.map((s) => [s.id, tareasDeSeccion(datos.tareas, s.id).filter(filtro).map((t) => t.id)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datos.tareas, datos.secciones, filtro],
  )
  const [arrastre, setArrastre] = useState<Columnas | null>(null)
  const [activo, setActivo] = useState<string | null>(null)
  const [nuevaSeccion, setNuevaSeccion] = useState(false)
  const columnas = arrastre ?? base

  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // En el celular hay que mantener apretado para arrastrar: si no, no se podria scrollear.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragStart(e: DragStartEvent) {
    setActivo(String(e.active.id))
    setArrastre(base)
  }

  // Al pasar a otra columna, la tarjeta se mueve ya en el estado local.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const id = String(active.id)
    const sobre = String(over.id)
    setArrastre((prev) => {
      if (!prev) return prev
      const desde = columnaDe(prev, id)
      const hacia = columnaDe(prev, sobre)
      if (!desde || !hacia || desde === hacia) return prev
      const destino = [...prev[hacia]]
      const idx = sobre.startsWith(COL) ? destino.length : destino.indexOf(sobre)
      destino.splice(idx < 0 ? destino.length : idx, 0, id)
      return { ...prev, [desde]: prev[desde].filter((x) => x !== id), [hacia]: destino }
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const cols = arrastre
    setActivo(null)
    setArrastre(null)
    if (!over || !cols) return
    const id = String(active.id)
    const hacia = columnaDe(cols, id)
    if (!hacia) return

    let lista = cols[hacia]
    const sobre = String(over.id)
    if (!sobre.startsWith(COL) && lista.includes(sobre)) {
      lista = arrayMove(lista, lista.indexOf(id), lista.indexOf(sobre))
    }
    const idx = lista.indexOf(id)
    const tarea = porId.get(id)
    if (!tarea) return

    const anterior = lista[idx - 1]
    const siguiente = lista[idx + 1]
    const mismaPosicion =
      tarea.seccion_id === hacia &&
      base[hacia][base[hacia].indexOf(id) - 1] === anterior &&
      base[hacia][base[hacia].indexOf(id) + 1] === siguiente
    if (mismaPosicion) return

    const orden = ordenEntre(
      anterior ? porId.get(anterior)?.orden : undefined,
      siguiente ? porId.get(siguiente)?.orden : undefined,
    )
    acciones.editarTarea(id, tarea.seccion_id === hacia ? { orden } : { seccion_id: hacia, orden })
  }

  const tareaActiva = activo ? porId.get(activo) : null

  return (
    <DndContext
      sensors={sensores}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActivo(null)
        setArrastre(null)
      }}
    >
      <div className="-mx-4 flex items-start gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {secciones.map((s) => (
          <Columna
            key={s.id}
            id={s.id}
            ids={columnas[s.id] ?? []}
            encabezado={
              <EncabezadoSeccion
                seccion={s}
                secciones={datos.secciones}
                cantidad={(columnas[s.id] ?? []).length}
                acciones={acciones}
                onEliminar={onEliminarSeccion}
                className="px-1"
              />
            }
            pie={<AgregarInline texto="Agregar tarjeta" onCrear={(titulo) => acciones.crearTarea({ seccion_id: s.id, titulo })} />}
          >
            {(columnas[s.id] ?? []).map((id) => {
              const t = porId.get(id)
              return t ? <TarjetaOrdenable key={id} tarea={t} {...{ datos, usuarios, acciones, onAbrir }} /> : null
            })}
          </Columna>
        ))}

        <div className="w-72 shrink-0">
          {nuevaSeccion ? (
            <AgregarSeccionInput onCrear={(n) => acciones.crearSeccion(n)} onCerrar={() => setNuevaSeccion(false)} />
          ) : (
            <button
              type="button"
              onClick={() => setNuevaSeccion(true)}
              className="w-full rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              + Agregar columna
            </button>
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {tareaActiva && <Tarjeta tarea={tareaActiva} {...{ datos, usuarios, acciones }} arrastrando />}
      </DragOverlay>
    </DndContext>
  )
}

function Columna({
  id,
  ids,
  encabezado,
  pie,
  children,
}: {
  id: string
  ids: string[]
  encabezado: ReactNode
  pie: ReactNode
  children: ReactNode
}) {
  // La columna tambien es "soltable", para poder soltar en una columna vacia.
  const { setNodeRef, isOver } = useDroppable({ id: COL + id })
  return (
    <section
      className={cn(
        'flex max-h-[max(24rem,calc(100dvh-15rem))] w-72 shrink-0 flex-col rounded-lg border border-border bg-secondary/70 transition-colors',
        isOver && 'border-primary/40',
      )}
    >
      <div className="px-2 pb-1 pt-2">{encabezado}</div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto px-2 py-1">
          {children}
        </div>
      </SortableContext>
      <div className="p-1.5">{pie}</div>
    </section>
  )
}

type PropsTarjeta = Pick<PropsVista, 'datos' | 'usuarios' | 'acciones'> & { tarea: Tarea }

function TarjetaOrdenable(props: PropsTarjeta & { onAbrir: (id: string) => void }) {
  const { tarea, onAbrir } = props
  const temporal = esTemporal(tarea.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tarea.id,
    disabled: temporal,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => !temporal && onAbrir(tarea.id)}
      className={cn('touch-manipulation', isDragging && 'opacity-30', temporal && 'opacity-60')}
    >
      <Tarjeta {...props} />
    </div>
  )
}

function Tarjeta({ tarea, datos, usuarios, acciones, arrastrando }: PropsTarjeta & { arrastrando?: boolean }) {
  return (
    <article
      className={cn(
        'cursor-pointer rounded-md border border-border bg-card p-2.5 shadow-xs transition-shadow hover:border-primary/30 hover:shadow-sm',
        arrastrando && 'rotate-2 cursor-grabbing shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="pt-0.5">
          <CheckTarea
            tamano="sm"
            completada={tarea.completada}
            disabled={esTemporal(tarea.id)}
            onCambiar={(v) => acciones.editarTarea(tarea.id, { completada: v })}
          />
        </span>
        <p className={cn('min-w-0 flex-1 break-words text-sm leading-snug text-foreground', tarea.completada && 'text-muted-foreground line-through')}>
          {tarea.titulo}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 empty:hidden">
        <MetaTarea tarea={tarea} tareas={datos.tareas} etiquetas={datos.etiquetas} usuarios={usuarios} conAvatar={false} />
        {tarea.responsable_id && (
          <Avatar usuario={usuarios.get(tarea.responsable_id)} tamano="xs" className="ml-auto" />
        )}
      </div>
    </article>
  )
}
