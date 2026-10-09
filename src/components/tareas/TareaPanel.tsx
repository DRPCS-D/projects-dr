import { Check, ChevronRight, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { ConfirmModal } from '@/components/ui/modal'
import { esTemporal, type AccionesProyecto } from '@/hooks/useProyecto'
import { formatFechaHora } from '@/lib/format'
import { subtareasDe } from '@/lib/tareas'
import { COLORES, PRIORIDAD_LABEL, type DatosProyecto, type Prioridad, type Tarea, type Usuario } from '@/lib/tipos'
import { cn } from '@/lib/utils'
import { AgregarInline, CheckTarea, EtiquetaChip, FechaTarea } from './comun'
import { DescripcionTarea } from './DescripcionTarea'

/**
 * Detalle de una tarea en un panel lateral (como Asana): se edita campo por
 * campo y cada cambio se guarda solo, sin boton "Guardar". Los textos se
 * guardan al salir del campo.
 */
export function TareaPanel({
  tareaId,
  datos,
  acciones,
  usuarios,
  onCerrar,
  onAbrir,
}: {
  tareaId: string | null
  datos: DatosProyecto
  acciones: AccionesProyecto
  usuarios: Map<string, Usuario>
  onCerrar: () => void
  onAbrir: (id: string) => void
}) {
  const tarea = datos.tareas.find((t) => t.id === tareaId) ?? null
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')
  const [confirmarBorrar, setConfirmarBorrar] = useState(false)

  // Solo al cambiar de tarea: si se re-sincronizara con cada render, lo que
  // se esta escribiendo se pisaria cuando vuelve la respuesta del servidor.
  useEffect(() => {
    setTitulo(tarea?.titulo ?? '')
    setDescripcion(tarea?.descripcion ?? '')
    setNuevaEtiqueta('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarea?.id])

  useEffect(() => {
    if (!tareaId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) onCerrar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tareaId, onCerrar])

  if (!tarea) return null

  const editar = (cambios: Parameters<AccionesProyecto['editarTarea']>[1]) => acciones.editarTarea(tarea.id, cambios)
  const padre = tarea.parent_id ? datos.tareas.find((t) => t.id === tarea.parent_id) : null
  const subtareas = subtareasDe(datos.tareas, tarea.id)
  const miembros = datos.proyecto.miembros
    .map((id) => usuarios.get(id))
    .filter((u): u is Usuario => Boolean(u))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const responsable = tarea.responsable_id ? usuarios.get(tarea.responsable_id) : null
  const temporal = esTemporal(tarea.id)

  async function crearEtiqueta() {
    const nombre = nuevaEtiqueta.trim()
    if (!nombre || !tarea) return
    setNuevaEtiqueta('')
    const e = await acciones.crearEtiqueta(nombre, COLORES[datos.etiquetas.length % COLORES.length])
    if (e) editar({ etiquetas: [...tarea.etiquetas, e.id] })
  }

  return (
    <>
      {/* Fondo: en el celular el panel ocupa toda la pantalla; en escritorio se puede seguir viendo el tablero. */}
      <div className="fixed inset-0 z-40 bg-black/30 md:bg-black/10" onClick={onCerrar} />
      <aside
        role="dialog"
        aria-label={`Tarea: ${tarea.titulo}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-2xl md:w-[34rem]"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Button
            variant={tarea.completada ? 'secondary' : 'outline'}
            size="sm"
            disabled={temporal}
            onClick={() => editar({ completada: !tarea.completada })}
            className={cn(tarea.completada && 'text-success')}
          >
            <Check className={cn(!tarea.completada && 'text-muted-foreground')} />
            {tarea.completada ? 'Completada' : 'Marcar completada'}
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setConfirmarBorrar(true)} disabled={temporal} title="Eliminar tarea">
              <Trash2 />
            </Button>
            <Button variant="ghost" size="icon" onClick={onCerrar} title="Cerrar (Esc)">
              <X />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {padre && (
            <button
              type="button"
              onClick={() => onAbrir(padre.id)}
              className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Subtarea de <span className="font-medium text-foreground">{padre.titulo}</span>
              <ChevronRight className="size-3" />
            </button>
          )}

          <textarea
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onBlur={() => {
              const t = titulo.trim()
              if (!t) setTitulo(tarea.titulo)
              else if (t !== tarea.titulo) editar({ titulo: t })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            rows={1}
            disabled={temporal}
            className={cn(
              'field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 -mx-2 text-lg font-semibold text-foreground outline-none hover:border-border focus:border-input focus:ring-2 focus:ring-ring/40',
              tarea.completada && 'text-muted-foreground line-through',
            )}
          />

          <div className="mt-4 grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-3 text-sm">
            <span className="text-muted-foreground">Responsable</span>
            <div className="flex items-center gap-2">
              <Avatar usuario={responsable} />
              <Select
                value={tarea.responsable_id ?? ''}
                onChange={(e) => editar({ responsable_id: e.target.value || null })}
                disabled={temporal}
                className="h-8"
              >
                <option value="">Sin asignar</option>
                {miembros.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </Select>
            </div>

            <span className="text-muted-foreground">Inicio</span>
            <Input
              type="date"
              value={tarea.fecha_inicio ?? ''}
              onChange={(e) => editar({ fecha_inicio: e.target.value || null })}
              disabled={temporal}
              className="h-8 w-44"
            />

            <span className="text-muted-foreground">Vence</span>
            <div className="flex items-center gap-3">
              <Input
                type="date"
                value={tarea.fecha_vencimiento ?? ''}
                onChange={(e) => editar({ fecha_vencimiento: e.target.value || null })}
                disabled={temporal}
                className="h-8 w-44"
              />
              <FechaTarea tarea={tarea} />
            </div>

            <span className="text-muted-foreground">Prioridad</span>
            <Select
              value={tarea.prioridad ?? ''}
              onChange={(e) => editar({ prioridad: (e.target.value || null) as Prioridad | null })}
              disabled={temporal}
              className="h-8 w-44"
            >
              <option value="">Sin prioridad</option>
              {(Object.keys(PRIORIDAD_LABEL) as Prioridad[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORIDAD_LABEL[p]}
                </option>
              ))}
            </Select>

            {!tarea.parent_id && (
              <>
                <span className="text-muted-foreground">Sección</span>
                <Select
                  value={tarea.seccion_id}
                  onChange={(e) => editar({ seccion_id: e.target.value })}
                  disabled={temporal}
                  className="h-8 w-44"
                >
                  {[...datos.secciones]
                    .sort((a, b) => a.orden - b.orden)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                </Select>
              </>
            )}

            <span className="self-start pt-1 text-muted-foreground">Etiquetas</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {datos.etiquetas.map((e) => {
                const activa = tarea.etiquetas.includes(e.id)
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={temporal}
                    onClick={() =>
                      editar({ etiquetas: activa ? tarea.etiquetas.filter((x) => x !== e.id) : [...tarea.etiquetas, e.id] })
                    }
                    className={cn('rounded transition-opacity', !activa && 'opacity-35 hover:opacity-70')}
                    aria-pressed={activa}
                  >
                    <EtiquetaChip etiqueta={e} className="py-1" />
                  </button>
                )
              })}
              <input
                value={nuevaEtiqueta}
                onChange={(e) => setNuevaEtiqueta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    crearEtiqueta()
                  }
                }}
                onBlur={crearEtiqueta}
                disabled={temporal}
                placeholder="+ Nueva etiqueta"
                className="h-6 w-28 rounded border border-dashed border-border bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-input"
              />
            </div>
          </div>

          <Field label="Descripción" className="mt-6">
            <DescripcionTarea
              key={tarea.id}
              valor={descripcion}
              original={tarea.descripcion}
              onCambiar={setDescripcion}
              onGuardar={() => {
                if (descripcion !== tarea.descripcion) editar({ descripcion })
              }}
              disabled={temporal}
            />
          </Field>

          {!tarea.parent_id && (
            <div className="mt-6">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Subtareas
                {subtareas.length > 0 && (
                  <span className="ml-1">
                    ({subtareas.filter((s) => s.completada).length}/{subtareas.length})
                  </span>
                )}
              </p>
              <ul className="divide-y divide-border rounded-md border border-border empty:hidden">
                {subtareas.map((s) => (
                  <FilaSubtarea key={s.id} tarea={s} usuarios={usuarios} acciones={acciones} onAbrir={onAbrir} />
                ))}
              </ul>
              <AgregarInline
                texto="Agregar subtarea"
                placeholder="Título de la subtarea…"
                className="mt-1"
                onCrear={(t) => acciones.crearTarea({ seccion_id: tarea.seccion_id, parent_id: tarea.id, titulo: t })}
              />
            </div>
          )}

          <p className="mt-8 text-[11px] text-muted-foreground">
            Creada por {usuarios.get(tarea.creado_por)?.nombre ?? '—'} · {formatFechaHora(tarea.creado_en)}
            {tarea.completada_en && <> · completada {formatFechaHora(tarea.completada_en)}</>}
          </p>
        </div>
      </aside>

      <ConfirmModal
        abierto={confirmarBorrar}
        titulo="Eliminar tarea"
        mensaje={
          <>
            Se va a eliminar <strong className="text-foreground">{tarea.titulo}</strong>
            {subtareas.length > 0 && <> y sus {subtareas.length} subtareas</>}. No se puede deshacer.
          </>
        }
        onCancelar={() => setConfirmarBorrar(false)}
        onConfirmar={() => {
          setConfirmarBorrar(false)
          acciones.eliminarTarea(tarea.id)
          if (padre) onAbrir(padre.id)
          else onCerrar()
        }}
      />
    </>
  )
}

function FilaSubtarea({
  tarea,
  usuarios,
  acciones,
  onAbrir,
}: {
  tarea: Tarea
  usuarios: Map<string, Usuario>
  acciones: AccionesProyecto
  onAbrir: (id: string) => void
}) {
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <CheckTarea
        tamano="sm"
        completada={tarea.completada}
        disabled={esTemporal(tarea.id)}
        onCambiar={(v) => acciones.editarTarea(tarea.id, { completada: v })}
      />
      <button
        type="button"
        onClick={() => !esTemporal(tarea.id) && onAbrir(tarea.id)}
        className={cn('min-w-0 flex-1 truncate text-left hover:underline', tarea.completada && 'text-muted-foreground line-through')}
      >
        {tarea.titulo}
      </button>
      <FechaTarea tarea={tarea} />
      {tarea.responsable_id && <Avatar usuario={usuarios.get(tarea.responsable_id)} tamano="xs" />}
    </li>
  )
}
