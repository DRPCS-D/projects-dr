import { CheckCircle2, ChevronDown, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckTarea, FechaTarea, PrioridadIcono } from '@/components/tareas/comun'
import { Button } from '@/components/ui/button'
import { Cargando, ErrorBox, Vacio } from '@/components/ui/estado'
import { Kpi } from '@/components/ui/tabla'
import { invalidarResumenes, useMisTareas } from '@/hooks/useProyectos'
import { editarTarea } from '@/lib/datos'
import { mensajeDe } from '@/lib/errores'
import { descargarCSV } from '@/lib/exportar'
import { agruparMisTareas, GRUPOS_MIS_TAREAS, type GrupoMisTareas } from '@/lib/tareas'
import { PRIORIDAD_LABEL, type Tarea, type TareaMia } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * "Mis tareas" (Asana): todo lo asignado a mi en todos mis proyectos,
 * agrupado por vencimiento. Completar desde aca es optimista igual que en
 * el proyecto.
 */
export default function MisTareas() {
  const { data, loading, error, mutar } = useMisTareas()
  const [plegados, setPlegados] = useState<Set<GrupoMisTareas>>(new Set(['completadas']))
  const grupos = useMemo(() => agruparMisTareas(data), [data])

  async function completar(t: TareaMia, completada: boolean) {
    const aplicar = (cambios: Partial<Tarea>) => mutar((d) => d.map((x) => (x.id === t.id ? { ...x, ...cambios } : x)))
    aplicar({ completada, completada_en: completada ? new Date().toISOString() : null })
    try {
      const real = await editarTarea(t.id, { completada })
      aplicar(real)
      invalidarResumenes()
    } catch (e) {
      aplicar({ completada: t.completada, completada_en: t.completada_en })
      toast.error(mensajeDe(e, 'No se pudo guardar.'))
    }
  }

  function alternar(g: GrupoMisTareas) {
    setPlegados((p) => {
      const n = new Set(p)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })
  }

  function exportar() {
    descargarCSV('mis-tareas.csv', [
      ['Proyecto', 'Sección', 'Tarea', 'Vence', 'Prioridad', 'Completada'],
      ...data.map((t) => [
        t.proyecto.nombre,
        t.seccion_nombre,
        t.titulo,
        t.fecha_vencimiento,
        t.prioridad ? PRIORIDAD_LABEL[t.prioridad] : '',
        t.completada ? 'Sí' : 'No',
      ]),
    ])
  }

  const pendientes = data.filter((t) => !t.completada).length

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mis tareas</h1>
          <p className="text-sm text-muted-foreground">Lo que tenés asignado en todos tus proyectos.</p>
        </div>
        {data.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportar}>
            <Download /> Exportar
          </Button>
        )}
      </div>

      {loading ? (
        <Cargando texto="Cargando tus tareas…" />
      ) : error ? (
        <ErrorBox mensaje={error} />
      ) : pendientes === 0 && grupos.completadas.length === 0 ? (
        <Vacio
          icono={CheckCircle2}
          titulo="No tenés tareas asignadas"
          descripcion="Cuando alguien te asigne una tarea en un proyecto, va a aparecer acá."
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi titulo="Pendientes" valor={pendientes} />
            <Kpi titulo="Vencidas" valor={grupos.vencidas.length} tono={grupos.vencidas.length ? 'warning' : 'neutral'} />
            <Kpi titulo="Para hoy" valor={grupos.hoy.length} />
            <Kpi titulo="Próximos 7 días" valor={grupos.semana.length} />
          </div>
          <div className="space-y-4">
            {GRUPOS_MIS_TAREAS.filter((g) => grupos[g.id].length > 0).map((g) => {
              const plegado = plegados.has(g.id)
              return (
                <section key={g.id} className="rounded-lg border border-border bg-card shadow-xs">
                  <button
                    type="button"
                    onClick={() => alternar(g.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    aria-expanded={!plegado}
                  >
                    <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', plegado && '-rotate-90')} />
                    <h2 className={cn('text-sm font-semibold', g.id === 'vencidas' ? 'text-destructive' : 'text-foreground')}>
                      {g.titulo}
                    </h2>
                    <span className="text-xs text-muted-foreground">{grupos[g.id].length}</span>
                  </button>
                  {!plegado && (
                    <ul className="divide-y divide-border border-t border-border">
                      {grupos[g.id].map((t) => (
                        <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <CheckTarea completada={t.completada} onCambiar={(v) => completar(t, v)} />
                          <Link
                            to={`/proyectos/${t.proyecto.id}?tarea=${t.parent_id ?? t.id}`}
                            className={cn('min-w-0 flex-1 truncate hover:underline', t.completada && 'text-muted-foreground line-through')}
                          >
                            {t.titulo}
                          </Link>
                          <PrioridadIcono prioridad={t.prioridad} />
                          <FechaTarea tarea={t} className="shrink-0" />
                          <Link
                            to={`/proyectos/${t.proyecto.id}`}
                            className="hidden max-w-44 shrink-0 items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent sm:inline-flex"
                          >
                            <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: t.proyecto.color }} />
                            <span className="truncate">{t.proyecto.nombre}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
