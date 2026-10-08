import { Archive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GrupoAvatares } from '@/components/ui/avatar'
import type { ProyectoConResumen, Usuario } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/** Tarjeta de proyecto estilo Basecamp: color, nombre, descripcion, equipo y avance. */
export function TarjetaProyecto({ proyecto, usuarios }: { proyecto: ProyectoConResumen; usuarios: Map<string, Usuario> }) {
  const { resumen } = proyecto
  const avance = resumen.total ? Math.round((resumen.completadas / resumen.total) * 100) : 0
  const miembros = proyecto.miembros.map((id) => usuarios.get(id)).filter((u): u is Usuario => Boolean(u))
  return (
    <Link
      to={`/proyectos/${proyecto.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xs transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        proyecto.estado === 'archivado' && 'opacity-70',
      )}
    >
      <span className="h-1.5" style={{ backgroundColor: proyecto.color }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground group-hover:text-primary">
            {proyecto.nombre}
          </h2>
          {proyecto.estado === 'archivado' && <Archive className="size-3.5 shrink-0 text-muted-foreground" />}
        </div>
        <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-relaxed text-muted-foreground">
          {proyecto.descripcion || 'Sin descripción'}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <GrupoAvatares usuarios={miembros} max={4} tamano="xs" />
          <span className="ml-auto text-[11px] text-muted-foreground">
            {resumen.total === 0 ? 'Sin tareas' : `${resumen.completadas}/${resumen.total}`}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-success" style={{ width: `${avance}%` }} />
        </div>
        {resumen.vencidas > 0 && (
          <p className="mt-2 text-[11px] font-medium text-destructive">
            {resumen.vencidas} {resumen.vencidas === 1 ? 'tarea vencida' : 'tareas vencidas'}
          </p>
        )}
      </div>
    </Link>
  )
}
