import { FolderKanban, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProyectoFormModal } from '@/components/proyectos/ProyectoModales'
import { TarjetaProyecto } from '@/components/proyectos/TarjetaProyecto'
import { Button } from '@/components/ui/button'
import { Cargando, ErrorBox, Vacio } from '@/components/ui/estado'
import { Buscador } from '@/components/ui/tabla'
import { useEstadoSesion } from '@/hooks/useEstadoSesion'
import { useProyectos } from '@/hooks/useProyectos'
import { useUsuariosPorId } from '@/hooks/useUsuarios'
import { normalizar } from '@/lib/format'

export default function Proyectos() {
  const { data, loading, error, crear } = useProyectos()
  const usuarios = useUsuariosPorId()
  const navigate = useNavigate()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [vista, setVista] = useEstadoSesion('proyectos', { busqueda: '', archivados: false })

  const visibles = useMemo(() => {
    const q = normalizar(vista.busqueda)
    return data
      .filter((p) => (vista.archivados ? p.estado === 'archivado' : p.estado === 'activo'))
      .filter((p) => !q || normalizar(p.nombre).includes(q) || normalizar(p.descripcion).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [data, vista])
  const cantArchivados = data.filter((p) => p.estado === 'archivado').length

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Proyectos</h1>
          <p className="text-sm text-muted-foreground">Los proyectos de los que sos parte.</p>
        </div>
        <Button onClick={() => setModalNuevo(true)}>
          <Plus /> Nuevo proyecto
        </Button>
      </div>

      {data.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Buscador
            valor={vista.busqueda}
            onCambiar={(v) => setVista({ ...vista, busqueda: v })}
            placeholder="Buscar proyecto…"
            className="w-full max-w-sm"
          />
          {(cantArchivados > 0 || vista.archivados) && (
            <button
              type="button"
              onClick={() => setVista({ ...vista, archivados: !vista.archivados })}
              className="text-sm text-primary hover:underline"
            >
              {vista.archivados ? '← Ver activos' : `Ver archivados (${cantArchivados})`}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <Cargando texto="Cargando proyectos…" />
      ) : error ? (
        <ErrorBox mensaje={error} />
      ) : data.length === 0 ? (
        <Vacio
          icono={FolderKanban}
          titulo="Todavía no tenés proyectos"
          descripcion="Creá uno, sumá a tu equipo y empezá a organizar las tareas."
          accion={
            <Button onClick={() => setModalNuevo(true)}>
              <Plus /> Crear el primero
            </Button>
          }
        />
      ) : visibles.length === 0 ? (
        <Vacio icono={FolderKanban} titulo="Sin resultados" descripcion="Probá con otra búsqueda." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visibles.map((p) => (
            <TarjetaProyecto key={p.id} proyecto={p} usuarios={usuarios} />
          ))}
        </div>
      )}

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
