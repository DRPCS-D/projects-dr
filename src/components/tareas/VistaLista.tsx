import { ArrowLeft, ArrowRight, ChevronDown, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { MenuAcciones } from '@/components/ui/menu'
import { esTemporal, type AccionesProyecto } from '@/hooks/useProyecto'
import { ordenEntre, subtareasDe, tareasDeSeccion } from '@/lib/tareas'
import type { DatosProyecto, Etiqueta, Seccion, Tarea, Usuario } from '@/lib/tipos'
import { cn } from '@/lib/utils'
import { AgregarInline, CheckTarea, EtiquetaChip, FechaTarea, PrioridadIcono } from './comun'

export interface PropsVista {
  datos: DatosProyecto
  acciones: AccionesProyecto
  usuarios: Map<string, Usuario>
  /** Que tareas se ven (busqueda, responsable, completadas). */
  filtro: (t: Tarea) => boolean
  onAbrir: (id: string) => void
  onEliminarSeccion: (s: Seccion) => void
}

export function seccionesOrdenadas(secciones: Seccion[]): Seccion[] {
  return [...secciones].sort((a, b) => a.orden - b.orden)
}

/** Nombre de la seccion, editable en el lugar, con su menu (renombrar, mover, eliminar). */
export function EncabezadoSeccion({
  seccion,
  secciones,
  cantidad,
  acciones,
  onEliminar,
  className,
  antes,
}: {
  seccion: Seccion
  secciones: Seccion[]
  cantidad: number
  acciones: AccionesProyecto
  onEliminar: (s: Seccion) => void
  className?: string
  antes?: ReactNode
}) {
  const [editando, setEditando] = useState(false)
  const [nombre, setNombre] = useState(seccion.nombre)
  const orden = seccionesOrdenadas(secciones)
  const i = orden.findIndex((s) => s.id === seccion.id)

  function guardar() {
    setEditando(false)
    const n = nombre.trim()
    if (n && n !== seccion.nombre) acciones.editarSeccion(seccion.id, { nombre: n })
    else setNombre(seccion.nombre)
  }

  // Mover una posicion: queda entre el vecino y el siguiente a el.
  function mover(delta: -1 | 1) {
    const nuevo =
      delta === -1
        ? ordenEntre(orden[i - 2]?.orden, orden[i - 1].orden)
        : ordenEntre(orden[i + 1].orden, orden[i + 2]?.orden)
    acciones.editarSeccion(seccion.id, { orden: nuevo })
  }

  return (
    <div className={cn('group/seccion flex min-w-0 items-center gap-1.5', className)}>
      {antes}
      {editando ? (
        <input
          autoFocus
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') guardar()
            if (e.key === 'Escape') {
              setNombre(seccion.nombre)
              setEditando(false)
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-card px-2 text-sm font-semibold outline-none ring-2 ring-ring/30"
        />
      ) : (
        <h3
          className="min-w-0 cursor-text truncate text-sm font-semibold text-foreground"
          onDoubleClick={() => setEditando(true)}
          title="Doble clic para renombrar"
        >
          {seccion.nombre}
        </h3>
      )}
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{cantidad}</span>
      <MenuAcciones
        className="ml-auto shrink-0 opacity-60 group-hover/seccion:opacity-100"
        titulo="Acciones de la sección"
        opciones={[
          { label: 'Renombrar', icono: Pencil, onClick: () => setEditando(true) },
          { label: 'Mover a la izquierda', icono: ArrowLeft, onClick: () => mover(-1), oculto: i <= 0 },
          { label: 'Mover a la derecha', icono: ArrowRight, onClick: () => mover(1), oculto: i >= orden.length - 1 },
          { label: 'Eliminar sección', icono: Trash2, onClick: () => onEliminar(seccion), peligro: true, oculto: orden.length <= 1 },
        ]}
      />
    </div>
  )
}

/** Lo que va a la derecha del titulo de una tarea: subtareas, etiquetas, prioridad, fecha, responsable. */
export function MetaTarea({
  tarea,
  tareas,
  etiquetas,
  usuarios,
  conAvatar = true,
}: {
  tarea: Tarea
  tareas: Tarea[]
  etiquetas: Etiqueta[]
  usuarios: Map<string, Usuario>
  conAvatar?: boolean
}) {
  const subs = subtareasDe(tareas, tarea.id)
  const suyas = etiquetas.filter((e) => tarea.etiquetas.includes(e.id))
  return (
    <>
      {suyas.map((e) => (
        <EtiquetaChip key={e.id} etiqueta={e} />
      ))}
      {subs.length > 0 && (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground" title="Subtareas completadas">
          <ListChecks className="size-3" />
          {subs.filter((s) => s.completada).length}/{subs.length}
        </span>
      )}
      <PrioridadIcono prioridad={tarea.prioridad} />
      <FechaTarea tarea={tarea} />
      {conAvatar && tarea.responsable_id && <Avatar usuario={usuarios.get(tarea.responsable_id)} tamano="xs" />}
    </>
  )
}

/** Vista Lista (to-do lists de Basecamp): cada seccion es una lista plegable. */
export function VistaLista({ datos, acciones, usuarios, filtro, onAbrir, onEliminarSeccion }: PropsVista) {
  const [plegadas, setPlegadas] = useState<Set<string>>(new Set())
  const [nuevaSeccion, setNuevaSeccion] = useState(false)

  function alternar(id: string) {
    setPlegadas((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div className="space-y-4">
      {seccionesOrdenadas(datos.secciones).map((s) => {
        const tareas = tareasDeSeccion(datos.tareas, s.id).filter(filtro)
        const plegada = plegadas.has(s.id)
        return (
          <section key={s.id} className="rounded-lg border border-border bg-card shadow-xs">
            <EncabezadoSeccion
              seccion={s}
              secciones={datos.secciones}
              cantidad={tareas.length}
              acciones={acciones}
              onEliminar={onEliminarSeccion}
              className="border-b border-border px-3 py-2"
              antes={
                <button
                  type="button"
                  onClick={() => alternar(s.id)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={plegada ? 'Desplegar' : 'Plegar'}
                  aria-expanded={!plegada}
                >
                  <ChevronDown className={cn('size-4 transition-transform', plegada && '-rotate-90')} />
                </button>
              }
            />
            {!plegada && (
              <>
                <ul className="divide-y divide-border">
                  {tareas.map((t) => (
                    <li
                      key={t.id}
                      onClick={() => !esTemporal(t.id) && onAbrir(t.id)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/50',
                        esTemporal(t.id) && 'opacity-60',
                      )}
                    >
                      <CheckTarea
                        completada={t.completada}
                        disabled={esTemporal(t.id)}
                        onCambiar={(v) => acciones.editarTarea(t.id, { completada: v })}
                      />
                      <span className={cn('min-w-0 flex-1 truncate', t.completada && 'text-muted-foreground line-through')}>
                        {t.titulo}
                      </span>
                      <span className="hidden shrink-0 items-center gap-2 sm:flex">
                        <MetaTarea tarea={t} tareas={datos.tareas} etiquetas={datos.etiquetas} usuarios={usuarios} />
                      </span>
                      {t.responsable_id && (
                        <Avatar usuario={usuarios.get(t.responsable_id)} tamano="xs" className="sm:hidden" />
                      )}
                    </li>
                  ))}
                </ul>
                <div className="px-1 py-1">
                  <AgregarInline onCrear={(titulo) => acciones.crearTarea({ seccion_id: s.id, titulo })} />
                </div>
              </>
            )}
          </section>
        )
      })}

      {nuevaSeccion ? (
        <AgregarSeccionInput
          onCrear={(n) => acciones.crearSeccion(n)}
          onCerrar={() => setNuevaSeccion(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNuevaSeccion(true)}
          className="w-full rounded-lg border border-dashed border-border px-3 py-2.5 text-left text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          + Agregar sección
        </button>
      )}
    </div>
  )
}

export function AgregarSeccionInput({ onCrear, onCerrar }: { onCrear: (nombre: string) => void; onCerrar: () => void }) {
  const [valor, setValor] = useState('')
  function terminar() {
    const n = valor.trim()
    if (n) onCrear(n)
    onCerrar()
  }
  return (
    <input
      autoFocus
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={terminar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') terminar()
        if (e.key === 'Escape') onCerrar()
      }}
      placeholder="Nombre de la sección…"
      className="h-10 w-full rounded-lg border border-primary bg-card px-3 text-sm outline-none ring-2 ring-ring/30"
    />
  )
}
