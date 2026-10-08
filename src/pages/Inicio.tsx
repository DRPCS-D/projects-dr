import { ArrowRight, FolderKanban, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ProyectoFormModal } from '@/components/proyectos/ProyectoModales'
import { TarjetaProyecto } from '@/components/proyectos/TarjetaProyecto'
import { FechaTarea } from '@/components/tareas/comun'
import { Button } from '@/components/ui/button'
import { Cargando, Vacio } from '@/components/ui/estado'
import { Kpi } from '@/components/ui/tabla'
import { useAuth } from '@/hooks/useAuth'
import { useMisTareas, useProyectos } from '@/hooks/useProyectos'
import { useUsuariosPorId } from '@/hooks/useUsuarios'
import { agruparMisTareas } from '@/lib/tareas'

/**
 * Portada (el "Home" de Basecamp): mis proyectos activos arriba y, al
 * costado, lo mio que vence pronto.
 */
export default function Inicio() {
  const { usuario } = useAuth()
  const { data: proyectos, loading, crear } = useProyectos()
  const { data: mias, loading: cargandoMias } = useMisTareas()
  const usuarios = useUsuariosPorId()
  const navigate = useNavigate()
  const [modalNuevo, setModalNuevo] = useState(false)

  const activos = useMemo(
    () => proyectos.filter((p) => p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [proyectos],
  )
  const grupos = useMemo(() => agruparMisTareas(mias), [mias])
  const urgentes = [...grupos.vencidas, ...grupos.hoy, ...grupos.semana].slice(0, 8)
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? ''

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Hola{primerNombre ? `, ${primerNombre}` : ''}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Esto es lo que está pasando en tus proyectos.</p>
        </div>
        <Button onClick={() => setModalNuevo(true)}>
          <Plus /> Nuevo proyecto
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi titulo="Proyectos activos" valor={activos.length} />
        <Kpi titulo="Mis pendientes" valor={mias.filter((t) => !t.completada).length} />
        <Kpi titulo="Vencidas" valor={grupos.vencidas.length} tono={grupos.vencidas.length ? 'warning' : 'neutral'} />
        <Kpi titulo="Para hoy" valor={grupos.hoy.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Proyectos</h2>
            <Link to="/proyectos" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Ver todos <ArrowRight className="size-3" />
            </Link>
          </div>
          {loading ? (
            <Cargando />
          ) : activos.length === 0 ? (
            <div className="rounded-lg border border-border bg-card">
              <Vacio
                icono={FolderKanban}
                titulo="Todavía no tenés proyectos"
                descripcion="Creá uno y sumá a tu equipo."
                accion={
                  <Button size="sm" onClick={() => setModalNuevo(true)}>
                    <Plus /> Nuevo proyecto
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {activos.map((p) => (
                <TarjetaProyecto key={p.id} proyecto={p} usuarios={usuarios} />
              ))}
            </div>
          )}
        </section>

        <aside>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Lo mío, pronto</h2>
            <Link to="/mis-tareas" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Mis tareas <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="rounded-lg border border-border bg-card shadow-xs">
            {cargandoMias ? (
              <Cargando />
            ) : urgentes.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">Nada que venza en los próximos 7 días.</p>
            ) : (
              <ul className="divide-y divide-border">
                {urgentes.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={`/proyectos/${t.proyecto.id}?tarea=${t.parent_id ?? t.id}`}
                      className="block px-3 py-2.5 hover:bg-accent/50"
                    >
                      <p className="truncate text-sm text-foreground">{t.titulo}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: t.proyecto.color }} />
                        <span className="min-w-0 flex-1 truncate">{t.proyecto.nombre}</span>
                        <FechaTarea tarea={t} />
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <ProyectoFormModal
        abierto={modalNuevo}
        onCerrar={() => setModalNuevo(false)}
        onCrear={async (datos) => {
          const p = await crear(datos)
          navigate(`/proyectos/${p.id}`)
        }}
      />
    </div>
  )
}
