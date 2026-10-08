import { Plus, UserRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CambiarMiPasswordModal } from '@/components/cuenta/CambiarMiPasswordModal'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cargando, ErrorBox, Vacio } from '@/components/ui/estado'
import { Buscador, ContadorLista, Th } from '@/components/ui/tabla'
import {
  EditarUsuarioModal,
  NuevoUsuarioModal,
  ResetearPasswordModal,
  UsuarioDetalleModal,
} from '@/components/usuarios/UsuarioModales'
import { useAuth } from '@/hooks/useAuth'
import { useEstadoSesion } from '@/hooks/useEstadoSesion'
import { useUsuarios } from '@/hooks/useUsuarios'
import { formatFecha, normalizar } from '@/lib/format'
import { ordenar, type Orden } from '@/lib/orden'
import type { Usuario } from '@/lib/tipos'

type CampoOrden = 'nombre' | 'email' | 'estado' | 'alta'

function valorOrden(u: Usuario, campo: CampoOrden): unknown {
  switch (campo) {
    case 'nombre':
      return u.nombre
    case 'email':
      return u.email
    case 'estado':
      return u.activo ? 'Activo' : 'Inactivo'
    case 'alta':
      return u.creado_en
  }
}

/** Todas las cuentas del sistema. Un solo nivel: cualquiera las gestiona. */
export default function Usuarios() {
  const { usuario: yo, refrescarPerfil } = useAuth()
  const { data, loading, error, crear, editar, setActivo, cambiarPassword } = useUsuarios()
  const [vista, setVista] = useEstadoSesion<{ busqueda: string; orden: Orden<CampoOrden> }>('usuarios', {
    busqueda: '',
    orden: { campo: 'nombre', dir: 'asc' },
  })
  const { busqueda, orden } = vista
  const th = { orden, onOrdenar: (o: Orden<CampoOrden>) => setVista({ ...vista, orden: o }) }

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda)
    const pasan = q ? data.filter((u) => normalizar(u.nombre).includes(q) || normalizar(u.email).includes(q)) : data
    return ordenar(pasan, orden, valorOrden)
  }, [data, busqueda, orden])

  const [modalNuevo, setModalNuevo] = useState(false)
  const [detalle, setDetalle] = useState<Usuario | null>(null)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [reseteando, setReseteando] = useState<Usuario | null>(null)
  const [cambiandoMia, setCambiandoMia] = useState(false)

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Usuarios</h1>
          <p className="text-sm text-muted-foreground">Quienes pueden entrar al sistema.</p>
        </div>
        <Button onClick={() => setModalNuevo(true)}>
          <Plus /> Nuevo usuario
        </Button>
      </div>

      {data.length > 0 && (
        <Buscador
          valor={busqueda}
          onCambiar={(v) => setVista({ ...vista, busqueda: v })}
          placeholder="Buscar por nombre o email…"
          className="mb-4 max-w-sm"
        />
      )}

      {loading ? (
        <Cargando />
      ) : error ? (
        <ErrorBox mensaje={error} />
      ) : filtrados.length === 0 ? (
        <Vacio icono={UserRound} titulo="Sin resultados" descripcion="Probá con otra búsqueda." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <Th campo="nombre" {...th} className="px-4">
                    Nombre
                  </Th>
                  <Th campo="email" {...th} className="px-4">
                    Email
                  </Th>
                  <Th campo="alta" {...th} className="hidden px-4 sm:table-cell">
                    Alta
                  </Th>
                  <Th campo="estado" {...th} className="px-4">
                    Estado
                  </Th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setDetalle(u)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5 font-medium text-foreground">
                        <Avatar usuario={u} />
                        {u.nombre}
                        {u.id === yo?.id && <span className="text-xs font-normal text-muted-foreground">(vos)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatFecha(u.creado_en)}</td>
                    <td className="px-4 py-2.5">
                      <Badge tono={u.activo ? 'success' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ContadorLista mostradas={filtrados.length} total={data.length} />
        </div>
      )}

      <NuevoUsuarioModal abierto={modalNuevo} onCerrar={() => setModalNuevo(false)} crear={crear} />

      <UsuarioDetalleModal
        usuario={detalle}
        esYo={detalle?.id === yo?.id}
        onCerrar={() => setDetalle(null)}
        onEditar={() => {
          setEditando(detalle)
          setDetalle(null)
        }}
        onCambiarPassword={() => {
          if (detalle?.id === yo?.id) setCambiandoMia(true)
          else setReseteando(detalle)
          setDetalle(null)
        }}
        setActivo={setActivo}
      />

      <EditarUsuarioModal
        usuario={editando}
        onCerrar={() => setEditando(null)}
        editar={editar}
        onGuardado={(u) => {
          if (u.id === yo?.id) refrescarPerfil()
        }}
      />

      <ResetearPasswordModal usuario={reseteando} onCerrar={() => setReseteando(null)} cambiarPassword={cambiarPassword} />

      <CambiarMiPasswordModal abierto={cambiandoMia} onCerrar={() => setCambiandoMia(false)} />
    </div>
  )
}
