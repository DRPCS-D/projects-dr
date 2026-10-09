import { KeyRound, Pencil, UserCheck, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Avatar, SelectorColor } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBox } from '@/components/ui/estado'
import { Field, Input, Select } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { useUsuarios } from '@/hooks/useUsuarios'
import { mensajeDe } from '@/lib/errores'
import { formatFecha } from '@/lib/format'
import { COLORES, ROL_LABEL, type Rol, type Usuario } from '@/lib/tipos'

/**
 * Modales de gestion de usuarios. Un solo nivel de usuario: cualquiera da de
 * alta, edita, desactiva o resetea la clave de otro (el servidor solo impide
 * desactivarse a uno mismo).
 */

type Acciones = ReturnType<typeof useUsuarios>

function SelectorRol({
  valor,
  onCambiar,
  disabled,
  hint,
}: {
  valor: Rol
  onCambiar: (r: Rol) => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <Field label="Rol" hint={hint ?? 'Los administradores gestionan usuarios. Ver proyectos depende de ser miembro, no del rol.'}>
      <Select value={valor} onChange={(e) => onCambiar(e.target.value as Rol)} disabled={disabled}>
        <option value="usuario">{ROL_LABEL.usuario}</option>
        <option value="admin">{ROL_LABEL.admin}</option>
      </Select>
    </Field>
  )
}

export function NuevoUsuarioModal({
  abierto,
  onCerrar,
  crear,
}: {
  abierto: boolean
  onCerrar: () => void
  crear: Acciones['crear']
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<Rol>('usuario')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (abierto) {
      setNombre('')
      setEmail('')
      setPassword('')
      setRol('usuario')
      setError(null)
    }
  }, [abierto])

  async function guardar() {
    if (!nombre.trim() || !email.trim()) return setError('Completá nombre y email.')
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    setGuardando(true)
    setError(null)
    try {
      await crear({ nombre: nombre.trim(), email: email.trim(), password, rol })
      toast.success('Usuario creado', { description: 'Pasale su email y contraseña para que entre.' })
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear el usuario.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo="Nuevo usuario"
      descripcion="La persona entra con este email y contraseña, y puede cambiarla después."
      onCerrar={onCerrar}
      ancho="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear usuario'}
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
        <Field label="Nombre completo">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Contraseña inicial" hint="Mínimo 8 caracteres.">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
        <SelectorRol valor={rol} onCambiar={setRol} />
        {error && <ErrorBox mensaje={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function UsuarioDetalleModal({
  usuario,
  esYo,
  onCerrar,
  onEditar,
  onCambiarPassword,
  setActivo,
}: {
  usuario: Usuario | null
  esYo: boolean
  onCerrar: () => void
  onEditar: () => void
  onCambiarPassword: () => void
  setActivo: Acciones['setActivo']
}) {
  const [procesando, setProcesando] = useState(false)
  if (!usuario) return null

  async function alternarActivo() {
    if (!usuario) return
    setProcesando(true)
    try {
      await setActivo(usuario.id, !usuario.activo)
      toast.success(usuario.activo ? 'Usuario desactivado' : 'Usuario activado')
      onCerrar()
    } catch (e) {
      toast.error(mensajeDe(e))
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Modal abierto titulo="Usuario" onCerrar={onCerrar} ancho="max-w-md">
      <div className="flex items-center gap-3">
        <Avatar usuario={usuario} tamano="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{usuario.nombre}</p>
          <p className="truncate text-sm text-muted-foreground">{usuario.email}</p>
        </div>
        <Badge tono={usuario.activo ? 'success' : 'neutral'}>{usuario.activo ? 'Activo' : 'Inactivo'}</Badge>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {ROL_LABEL[usuario.rol]} · Alta: {formatFecha(usuario.creado_en)}
      </p>

      <div className="mt-5 grid gap-2">
        <Button variant="outline" onClick={onEditar}>
          <Pencil /> Editar datos
        </Button>
        <Button variant="outline" onClick={onCambiarPassword}>
          <KeyRound /> {esYo ? 'Cambiar mi contraseña' : 'Resetear contraseña'}
        </Button>
        {!esYo && (
          <Button variant={usuario.activo ? 'destructive' : 'primary'} onClick={alternarActivo} disabled={procesando}>
            {usuario.activo ? <UserX /> : <UserCheck />}
            {usuario.activo ? 'Desactivar (ya no podrá entrar)' : 'Activar'}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export function EditarUsuarioModal({
  usuario,
  esYo,
  onCerrar,
  editar,
  onGuardado,
}: {
  usuario: Usuario | null
  esYo: boolean
  onCerrar: () => void
  editar: Acciones['editar']
  onGuardado?: (u: Usuario) => void
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [color, setColor] = useState(COLORES[0])
  const [rol, setRol] = useState<Rol>('usuario')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (usuario) {
      setNombre(usuario.nombre)
      setEmail(usuario.email)
      setRol(usuario.rol)
      setColor(usuario.color || COLORES[0])
      setError(null)
    }
  }, [usuario])

  async function guardar() {
    if (!usuario) return
    setGuardando(true)
    setError(null)
    try {
      const u = await editar({ id: usuario.id, nombre, email, color, rol })
      onGuardado?.(u)
      toast.success('Datos actualizados')
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudieron guardar los datos.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={usuario !== null}
      titulo="Editar usuario"
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
      <div className="space-y-4">
        <Field label="Nombre completo">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" hint="Es con el que inicia sesión.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <SelectorRol
          valor={rol}
          onCambiar={setRol}
          disabled={esYo}
          hint={esYo ? 'No podés cambiar tu propio rol: pedíselo a otro administrador.' : undefined}
        />
        <Field label="Color del avatar">
          <SelectorColor colores={COLORES} valor={color} onCambiar={setColor} />
        </Field>
        {error && <ErrorBox mensaje={error} />}
      </div>
    </Modal>
  )
}

/** Resetear la clave de OTRA persona (la propia se cambia con CambiarMiPasswordModal, que pide la actual). */
export function ResetearPasswordModal({
  usuario,
  onCerrar,
  cambiarPassword,
}: {
  usuario: Usuario | null
  onCerrar: () => void
  cambiarPassword: Acciones['cambiarPassword']
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (usuario) {
      setPassword('')
      setError(null)
    }
  }, [usuario])

  async function guardar() {
    if (!usuario) return
    if (password.length < 8) return setError('Mínimo 8 caracteres.')
    setGuardando(true)
    setError(null)
    try {
      await cambiarPassword(usuario.id, password)
      toast.success('Contraseña reseteada', { description: 'Sus sesiones abiertas se cerraron.' })
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar la contraseña.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={usuario !== null}
      titulo={`Resetear contraseña de ${usuario?.nombre ?? ''}`}
      onCerrar={onCerrar}
      ancho="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Resetear'}
          </Button>
        </>
      }
    >
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres. Pasásela a la persona por un canal seguro.">
        <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" />
      </Field>
      {error && (
        <div className="mt-3">
          <ErrorBox mensaje={error} />
        </div>
      )}
    </Modal>
  )
}
