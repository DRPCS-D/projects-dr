import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { gas, guardarToken, leerToken, mensajeDe, onSesionExpirada } from '@/lib/api'
import { claveLocal } from '@/lib/app'
import { resetearRecursos } from '@/lib/recurso'
import type { Usuario } from '@/lib/tipos'

interface AuthState {
  /** La persona con sesion, o null. Hay un solo nivel de usuario: no hay roles. */
  usuario: Usuario | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Vuelve a pedir el perfil (despues de editar el propio nombre, por ejemplo). */
  refrescarPerfil: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(true)

  // Evita que una carga de perfil vieja pise a una nueva: si mientras se
  // valida el token guardado la persona inicia sesion (u otra pestana la
  // cierra), el resultado de la carga anterior ya no vale y se descarta.
  // Ver CLAUDE.md → "La carrera de auth/perfil al montar".
  const cargaActual = useRef(0)

  const cargarPerfil = useCallback(async (): Promise<boolean> => {
    const token = ++cargaActual.current
    if (!leerToken()) {
      setUsuario(null)
      return true
    }
    try {
      const u = await gas<Usuario>('auth.yo')
      if (token !== cargaActual.current) return false
      setUsuario(u)
    } catch {
      if (token !== cargaActual.current) return false
      // Un 401 ya borro el token en gas(). Si fue otro error (sin red), se
      // muestra el login igual: sin perfil no hay nada que dibujar.
      setUsuario(null)
    }
    return true
  }, [])

  useEffect(() => {
    let vivo = true
    cargarPerfil().then((vigente) => {
      if (vivo && vigente) setLoading(false)
    })

    // El backend dijo 401 (sesion vencida, cuenta desactivada, clave
    // reseteada): se vuelve al login en vez de dejar pantallas que fallan una
    // a una con "No autenticado".
    onSesionExpirada(() => {
      cargaActual.current++
      resetearRecursos()
      setUsuario(null)
    })

    // Cerrar sesion en una pestana la cierra en las demas.
    const claveSesion = claveLocal('sesion')
    const onStorage = (e: StorageEvent) => {
      if (e.key !== claveSesion) return
      resetearRecursos()
      setLoading(true)
      cargarPerfil().then((vigente) => {
        if (vivo && vigente) setLoading(false)
      })
    }
    window.addEventListener('storage', onStorage)

    return () => {
      vivo = false
      onSesionExpirada(null)
      window.removeEventListener('storage', onStorage)
    }
  }, [cargarPerfil])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const r = await gas<{ token: string; usuario: Usuario }>('auth.login', {
        email: email.trim(),
        password,
      })
      cargaActual.current++
      // Otra persona pudo haber usado este dispositivo: lo cacheado era suyo.
      resetearRecursos()
      guardarToken(r.token)
      setUsuario(r.usuario)
      return { error: null }
    } catch (e) {
      return { error: mensajeDe(e, 'No se pudo iniciar sesión. Intentalo de nuevo.') }
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await gas('auth.logout')
    } catch {
      // Si el servidor no contesta, igual se olvida el token de este lado.
    }
    cargaActual.current++
    guardarToken(null)
    resetearRecursos()
    setUsuario(null)
  }, [])

  const refrescarPerfil = useCallback(async () => {
    await cargarPerfil()
  }, [cargarPerfil])

  const valor = useMemo<AuthState>(
    () => ({ usuario, loading, signIn, signOut, refrescarPerfil }),
    [usuario, loading, signIn, signOut, refrescarPerfil],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth tiene que usarse dentro de <AuthProvider>')
  return ctx
}
