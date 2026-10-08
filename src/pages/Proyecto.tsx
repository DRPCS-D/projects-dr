import { Archive, ArchiveRestore, ArrowLeft, Columns3, Download, List, LogOut, Pencil, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { MiembrosModal, ProyectoFormModal } from '@/components/proyectos/ProyectoModales'
import { TareaPanel } from '@/components/tareas/TareaPanel'
import { VistaLista } from '@/components/tareas/VistaLista'
import { VistaTablero } from '@/components/tareas/VistaTablero'
import { GrupoAvatares } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Cargando, ErrorBox } from '@/components/ui/estado'
import { Field, Select } from '@/components/ui/field'
import { MenuAcciones } from '@/components/ui/menu'
import { ConfirmModal, Modal } from '@/components/ui/modal'
import { Buscador, SubTabs } from '@/components/ui/tabla'
import { useAuth } from '@/hooks/useAuth'
import { useEstadoSesion } from '@/hooks/useEstadoSesion'
import { useProyecto } from '@/hooks/useProyecto'
import { actualizarEnLista, quitarDeLista } from '@/hooks/useProyectos'
import { useUsuariosPorId } from '@/hooks/useUsuarios'
import { gas, mensajeDe } from '@/lib/api'
import { claveLocal } from '@/lib/app'
import { descargarCSV } from '@/lib/exportar'
import { normalizar } from '@/lib/format'
import { tareasDeSeccion } from '@/lib/tareas'
import { PRIORIDAD_LABEL, type Proyecto as TProyecto, type Seccion, type Tarea, type Usuario } from '@/lib/tipos'

const VISTAS = ['lista', 'tablero'] as const
type Vista = (typeof VISTAS)[number]
const CLAVE_VISTA = claveLocal('vista-proyecto')

function vistaGuardada(): Vista {
  try {
    const v = localStorage.getItem(CLAVE_VISTA)
    return v === 'lista' ? 'lista' : 'tablero'
  } catch {
    return 'tablero'
  }
}

interface Filtros {
  busqueda: string
  /** '' = todos · 'yo' · 'nadie' · id de usuario */
  responsable: string
  ocultarCompletadas: boolean
}

export default function Proyecto() {
  const { id = '', vista } = useParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const usuarios = useUsuariosPorId()
  const proyecto = useProyecto(id)
  const { datos, loading, error } = proyecto
  const [params, setParams] = useSearchParams()
  const tareaAbierta = params.get('tarea')

  const [filtros, setFiltros] = useEstadoSesion<Filtros>('filtros-proyecto', {
    busqueda: '',
    responsable: '',
    ocultarCompletadas: false,
  })

  const [modalEditar, setModalEditar] = useState(false)
  const [modalMiembros, setModalMiembros] = useState(false)
  const [modalEliminar, setModalEliminar] = useState(false)
  const [seccionAEliminar, setSeccionAEliminar] = useState<Seccion | null>(null)

  useEffect(() => {
    if (vista && VISTAS.includes(vista as Vista)) {
      try {
        localStorage.setItem(CLAVE_VISTA, vista)
      } catch {
        /* sin preferencia guardada */
      }
    }
  }, [vista])

  const abrirTarea = useCallback(
    (tid: string) =>
      setParams((p) => {
        p.set('tarea', tid)
        return p
      }),
    [setParams],
  )
  const cerrarTarea = useCallback(
    () =>
      setParams((p) => {
        p.delete('tarea')
        return p
      }),
    [setParams],
  )

  const filtro = useMemo(() => {
    const q = normalizar(filtros.busqueda)
    return (t: Tarea) => {
      if (filtros.ocultarCompletadas && t.completada) return false
      if (filtros.responsable === 'yo' && t.responsable_id !== usuario?.id) return false
      if (filtros.responsable === 'nadie' && t.responsable_id) return false
      if (filtros.responsable && !['yo', 'nadie'].includes(filtros.responsable) && t.responsable_id !== filtros.responsable) {
        return false
      }
      if (q && !normalizar(t.titulo).includes(q) && !normalizar(t.descripcion).includes(q)) return false
      return true
    }
  }, [filtros, usuario?.id])

  if (!VISTAS.includes(vista as Vista)) {
    return <Navigate to={`/proyectos/${id}/${vistaGuardada()}${params.size ? `?${params}` : ''}`} replace />
  }

  if (loading && !datos) return <Cargando texto="Cargando proyecto…" />
  if (error && !datos) {
    return (
      <div className="space-y-4">
        <ErrorBox mensaje={error} />
        <Link to="/proyectos" className="text-sm text-primary hover:underline">
          ← Volver a proyectos
        </Link>
      </div>
    )
  }
  if (!datos) return null

  const p = datos.proyecto
  const archivado = p.estado === 'archivado'
  const miembros = p.miembros.map((m) => usuarios.get(m)).filter((u): u is Usuario => Boolean(u))
  const principales = datos.tareas.filter((t) => !t.parent_id)
  const completadas = principales.filter((t) => t.completada).length
  const avance = principales.length ? Math.round((completadas / principales.length) * 100) : 0
  const filtrando = Boolean(filtros.busqueda || filtros.responsable || filtros.ocultarCompletadas)

  function reflejar(cambios: Partial<TProyecto>) {
    proyecto.reflejarProyecto(cambios)
    actualizarEnLista(p.id, cambios)
  }

  async function archivar() {
    try {
      const r = await gas<TProyecto>('proyectos.archivar', { id: p.id, archivado: !archivado })
      reflejar({ estado: r.estado })
      toast.success(r.estado === 'archivado' ? 'Proyecto archivado' : 'Proyecto reactivado')
    } catch (e) {
      toast.error(mensajeDe(e))
    }
  }

  async function salir() {
    try {
      await gas('proyectos.salir', { id: p.id })
      quitarDeLista(p.id)
      toast.success('Saliste del proyecto')
      navigate('/proyectos')
    } catch (e) {
      toast.error(mensajeDe(e))
    }
  }

  function exportar() {
    const secciones = new Map(datos!.secciones.map((s) => [s.id, s.nombre]))
    const etiquetas = new Map(datos!.etiquetas.map((e) => [e.id, e.nombre]))
    const titulos = new Map(datos!.tareas.map((t) => [t.id, t.titulo]))
    descargarCSV(`${p.nombre}.csv`, [
      ['Sección', 'Tarea', 'Subtarea de', 'Responsable', 'Inicio', 'Vence', 'Prioridad', 'Etiquetas', 'Completada', 'Descripción'],
      ...datos!.secciones
        .sort((a, b) => a.orden - b.orden)
        .flatMap((s) =>
          tareasDeSeccion(datos!.tareas, s.id).flatMap((t) => [
            t,
            ...datos!.tareas.filter((x) => x.parent_id === t.id).sort((a, b) => a.orden - b.orden),
          ]),
        )
        .map((t) => [
          secciones.get(t.seccion_id),
          t.titulo,
          t.parent_id ? titulos.get(t.parent_id) : '',
          t.responsable_id ? usuarios.get(t.responsable_id)?.nombre : '',
          t.fecha_inicio,
          t.fecha_vencimiento,
          t.prioridad ? PRIORIDAD_LABEL[t.prioridad] : '',
          t.etiquetas.map((e) => etiquetas.get(e)).filter(Boolean).join(', '),
          t.completada ? 'Sí' : 'No',
          t.descripcion,
        ]),
    ])
  }

  const propsVista = {
    datos,
    acciones: proyecto,
    usuarios,
    filtro,
    onAbrir: abrirTarea,
    onEliminarSeccion: (s: Seccion) => {
      if (datos.tareas.some((t) => t.seccion_id === s.id)) setSeccionAEliminar(s)
      else proyecto.eliminarSeccion(s.id)
    },
  }

  return (
    <div>
      {/* Cabecera del proyecto */}
      <div className="mb-5">
        <Link to="/proyectos" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Proyectos
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <span className="mt-1.5 size-3.5 shrink-0 rounded" style={{ backgroundColor: p.color }} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-foreground">{p.nombre}</h1>
            {p.descripcion && <p className="mt-0.5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{p.descripcion}</p>}
          </div>
          <button
            type="button"
            onClick={() => setModalMiembros(true)}
            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
            title="Equipo del proyecto"
          >
            <GrupoAvatares usuarios={miembros} />
            <span className="text-xs text-muted-foreground">{miembros.length}</span>
          </button>
          <MenuAcciones
            titulo="Acciones del proyecto"
            className="p-1.5"
            opciones={[
              { label: 'Editar proyecto', icono: Pencil, onClick: () => setModalEditar(true) },
              { label: 'Equipo', icono: Users, onClick: () => setModalMiembros(true) },
              { label: 'Exportar a CSV', icono: Download, onClick: exportar },
              { label: archivado ? 'Reactivar' : 'Archivar', icono: archivado ? ArchiveRestore : Archive, onClick: archivar },
              { label: 'Salir del proyecto', icono: LogOut, onClick: salir, oculto: p.miembros.length <= 1 },
              { label: 'Eliminar proyecto', icono: Trash2, onClick: () => setModalEliminar(true), peligro: true },
            ]}
          />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${avance}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {completadas} de {principales.length} tareas completadas
          </span>
        </div>

        {archivado && (
          <div className="mt-3 flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
            <Archive className="size-4 text-warning" />
            Este proyecto está archivado: no aparece en Inicio ni en Mis tareas.
            <Button size="sm" variant="outline" className="ml-auto" onClick={archivar}>
              Reactivar
            </Button>
          </div>
        )}
      </div>

      {/* Pestañas y filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SubTabs
          className="mb-0"
          tabs={[
            { to: `/proyectos/${id}/lista`, label: 'Lista', icono: List },
            { to: `/proyectos/${id}/tablero`, label: 'Tablero', icono: Columns3 },
          ]}
        />
        <Buscador
          valor={filtros.busqueda}
          onCambiar={(v) => setFiltros({ ...filtros, busqueda: v })}
          placeholder="Buscar tareas…"
          className="w-full sm:w-60"
        />
        <Select
          value={filtros.responsable}
          onChange={(e) => setFiltros({ ...filtros, responsable: e.target.value })}
          className="w-auto"
          aria-label="Filtrar por responsable"
        >
          <option value="">Todos</option>
          <option value="yo">Asignadas a mí</option>
          <option value="nadie">Sin asignar</option>
          {miembros
            .filter((m) => m.id !== usuario?.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filtros.ocultarCompletadas}
            onChange={(e) => setFiltros({ ...filtros, ocultarCompletadas: e.target.checked })}
            className="size-4 accent-[var(--primary)]"
          />
          Ocultar completadas
        </label>
        {filtrando && (
          <button
            type="button"
            onClick={() => setFiltros({ busqueda: '', responsable: '', ocultarCompletadas: false })}
            className="text-xs text-primary hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {vista === 'tablero' ? <VistaTablero {...propsVista} /> : <VistaLista {...propsVista} />}

      <TareaPanel
        tareaId={tareaAbierta}
        datos={datos}
        acciones={proyecto}
        usuarios={usuarios}
        onCerrar={cerrarTarea}
        onAbrir={abrirTarea}
      />

      <ProyectoFormModal
        abierto={modalEditar}
        proyecto={p}
        onCerrar={() => setModalEditar(false)}
        onGuardado={(r) => reflejar({ nombre: r.nombre, descripcion: r.descripcion, color: r.color })}
      />

      <MiembrosModal
        proyecto={modalMiembros ? p : null}
        onCerrar={() => setModalMiembros(false)}
        onGuardado={(ids) => reflejar({ miembros: ids })}
      />

      <ConfirmModal
        abierto={modalEliminar}
        titulo="Eliminar proyecto"
        palabra="eliminar"
        mensaje={
          <>
            Se van a borrar <strong className="text-foreground">{p.nombre}</strong> y todas sus tareas, secciones y
            etiquetas, para todo el equipo. No se puede deshacer. Si solo querés sacarlo de la vista, archivalo.
          </>
        }
        onCancelar={() => setModalEliminar(false)}
        onConfirmar={async () => {
          try {
            await gas('proyectos.eliminar', { id: p.id })
            quitarDeLista(p.id)
            toast.success('Proyecto eliminado')
            navigate('/proyectos')
          } catch (e) {
            toast.error(mensajeDe(e))
            setModalEliminar(false)
          }
        }}
      />

      <EliminarSeccionModal
        seccion={seccionAEliminar}
        secciones={datos.secciones}
        cantidad={seccionAEliminar ? datos.tareas.filter((t) => t.seccion_id === seccionAEliminar.id && !t.parent_id).length : 0}
        onCerrar={() => setSeccionAEliminar(null)}
        onConfirmar={(destino) => {
          if (seccionAEliminar) proyecto.eliminarSeccion(seccionAEliminar.id, destino)
          setSeccionAEliminar(null)
        }}
      />
    </div>
  )
}

/** Una seccion con tareas no se borra sin decir a donde van sus tareas. */
function EliminarSeccionModal({
  seccion,
  secciones,
  cantidad,
  onCerrar,
  onConfirmar,
}: {
  seccion: Seccion | null
  secciones: Seccion[]
  cantidad: number
  onCerrar: () => void
  onConfirmar: (destino: string) => void
}) {
  const otras = secciones.filter((s) => s.id !== seccion?.id).sort((a, b) => a.orden - b.orden)
  const [destino, setDestino] = useState('')
  useEffect(() => {
    setDestino(otras[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seccion?.id])

  return (
    <Modal
      abierto={seccion !== null}
      titulo={`Eliminar “${seccion?.nombre ?? ''}”`}
      onCerrar={onCerrar}
      ancho="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => onConfirmar(destino)} disabled={!destino}>
            Eliminar sección
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        La sección tiene {cantidad} {cantidad === 1 ? 'tarea' : 'tareas'}. ¿A dónde las pasamos?
      </p>
      <Field label="Mover tareas a">
        <Select value={destino} onChange={(e) => setDestino(e.target.value)}>
          {otras.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  )
}
