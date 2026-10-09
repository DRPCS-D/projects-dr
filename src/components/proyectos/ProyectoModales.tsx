import { Check } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, SelectorColor } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ErrorBox } from '@/components/ui/estado'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { useAuth } from '@/hooks/useAuth'
import { useUsuarios } from '@/hooks/useUsuarios'
import { editarProyecto, guardarMiembros } from '@/lib/datos'
import { mensajeDe } from '@/lib/errores'
import { normalizar } from '@/lib/format'
import { COLORES, type Proyecto } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/** Lista de personas activas con casillas. Quien esta usando la app siempre queda tildado. */
function SelectorMiembros({ seleccion, onCambiar }: { seleccion: string[]; onCambiar: (ids: string[]) => void }) {
  const { usuario } = useAuth()
  const { data: usuarios } = useUsuarios()
  const [busqueda, setBusqueda] = useState('')
  const activos = useMemo(() => {
    const q = normalizar(busqueda)
    return usuarios
      .filter((u) => u.activo)
      .filter((u) => !q || normalizar(u.nombre).includes(q) || normalizar(u.email).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [usuarios, busqueda])

  function alternar(id: string) {
    if (id === usuario?.id) return
    onCambiar(seleccion.includes(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id])
  }

  return (
    <div className="rounded-md border border-border">
      {usuarios.length > 6 && (
        <div className="border-b border-border p-2">
          <Input placeholder="Buscar persona…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="h-8" />
        </div>
      )}
      <ul className="max-h-60 overflow-y-auto py-1">
        {activos.map((u) => {
          const marcado = seleccion.includes(u.id) || u.id === usuario?.id
          const yo = u.id === usuario?.id
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => alternar(u.id)}
                disabled={yo}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {marcado && <Check className="size-3" />}
                </span>
                <Avatar usuario={u} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">
                    {u.nombre} {yo && <span className="text-muted-foreground">(vos)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Alta de proyecto (con miembros) o edicion de nombre/descripcion/color. */
export function ProyectoFormModal({
  abierto,
  proyecto,
  onCerrar,
  onCrear,
  onGuardado,
}: {
  abierto: boolean
  /** Si viene, se edita; si no, se crea. */
  proyecto?: Proyecto | null
  onCerrar: () => void
  onCrear?: (datos: { nombre: string; descripcion: string; color: string; miembros: string[] }) => Promise<unknown>
  onGuardado?: (p: Proyecto) => void
}) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [miembros, setMiembros] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    setNombre(proyecto?.nombre ?? '')
    setDescripcion(proyecto?.descripcion ?? '')
    setColor(proyecto?.color ?? COLORES[Math.floor(Math.random() * COLORES.length)])
    setMiembros([])
    setError(null)
  }, [abierto, proyecto])

  async function guardar() {
    if (!nombre.trim()) return setError('Poné un nombre al proyecto.')
    setGuardando(true)
    setError(null)
    try {
      if (proyecto) {
        const p = await editarProyecto(proyecto.id, { nombre, descripcion, color })
        onGuardado?.(p)
        toast.success('Proyecto actualizado')
      } else {
        await onCrear?.({ nombre, descripcion, color, miembros })
      }
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar el proyecto.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo={proyecto ? 'Editar proyecto' : 'Nuevo proyecto'}
      descripcion={proyecto ? undefined : 'Un proyecto reúne a su equipo, sus tareas y su tablero.'}
      onCerrar={onCerrar}
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : proyecto ? 'Guardar' : 'Crear proyecto'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          guardar()
        }}
      >
        <Field label="Nombre">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Lanzamiento web 2027" autoFocus />
        </Field>
        <Field label="Descripción" hint="Opcional: de qué se trata, objetivo, enlaces útiles.">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} />
        </Field>
        <Field label="Color">
          <SelectorColor colores={COLORES} valor={color} onCambiar={setColor} />
        </Field>
        {!proyecto && (
          <Field label="Equipo" hint="Solo los miembros ven el proyecto. Podés cambiarlo después.">
            <SelectorMiembros seleccion={miembros} onCambiar={setMiembros} />
          </Field>
        )}
        {error && <ErrorBox mensaje={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Quienes son miembros del proyecto. */
export function MiembrosModal({
  proyecto,
  onCerrar,
  onGuardado,
}: {
  proyecto: Proyecto | null
  onCerrar: () => void
  onGuardado: (miembros: string[]) => void
}) {
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (proyecto) {
      setSeleccion(proyecto.miembros)
      setError(null)
    }
  }, [proyecto])

  async function guardar() {
    if (!proyecto) return
    setGuardando(true)
    setError(null)
    try {
      const ids = await guardarMiembros(proyecto.id, seleccion)
      onGuardado(ids)
      toast.success('Equipo actualizado')
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar el equipo.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={proyecto !== null}
      titulo="Equipo del proyecto"
      descripcion="Solo los miembros pueden ver y trabajar en este proyecto."
      onCerrar={onCerrar}
      ancho="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      }
    >
      <SelectorMiembros seleccion={seleccion} onCambiar={setSeleccion} />
      {error && (
        <div className="mt-3">
          <ErrorBox mensaje={error} />
        </div>
      )}
    </Modal>
  )
}
