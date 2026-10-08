import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ErrorBox } from '@/components/ui/estado'
import { Field, Input } from '@/components/ui/field'
import { Modal } from '@/components/ui/modal'
import { gas, mensajeDe } from '@/lib/api'

/**
 * Cambiar la propia contraseña. Pide la actual: si alguien deja la sesion
 * abierta en una compu ajena, no basta con eso para quedarse con la cuenta.
 * El servidor cierra las OTRAS sesiones abiertas; esta sigue valiendo.
 */
export function CambiarMiPasswordModal({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const [actual, setActual] = useState('')
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (abierto) {
      setActual('')
      setPassword('')
      setConfirmacion('')
      setError(null)
    }
  }, [abierto])

  async function onGuardar() {
    if (!actual) return setError('Ingresá tu contraseña actual.')
    if (password.length < 8) return setError('La nueva necesita al menos 8 caracteres.')
    if (password !== confirmacion) return setError('Las contraseñas nuevas no coinciden.')

    setGuardando(true)
    setError(null)
    try {
      await gas('auth.cambiarPassword', { actual, nueva: password })
      toast.success('Contraseña actualizada', { description: 'Se cerraron tus otras sesiones abiertas.' })
      onCerrar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar la contraseña.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo="Cambiar mi contraseña"
      onCerrar={onCerrar}
      ancho="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Cambiar'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onGuardar()
        }}
      >
        <Field label="Contraseña actual">
          <Input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repetir nueva contraseña">
          <Input type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="new-password" />
        </Field>
        {error && <ErrorBox mensaje={error} />}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
