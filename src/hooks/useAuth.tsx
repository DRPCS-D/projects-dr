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
import { ErrorApi, gas, guardarToken, leerToken, mensajeDe, onSesionExpirada } from '@/lib/api'
import { claveLocal } from '@/lib/app'
import { resetearRecursos } from '@/lib/recurso'
import type { Usuario } from '@/lib/tipos'

interface AuthState {
  /** La persona con sesion, o null. Hay un solo nivel de usuario: no hay roles. */
  usuario: Usuario | null
  loading: boolean
  /**
   * No se pudo hablar con el servidor Y no hay un perfil guardado para
   * mostrar. Es distinto de "sin sesion": el token sigue guardado, asi que
   * hay que ofrecer reintentar, no mandar al login.
   */
  errorConexion: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Vuelve a pedir el perfil (despues de editar el propio nombre, por ejemplo). */
  refrescarPerfil: () => Promise<void>
  reintentar: () => void
}

const AuthContext = createContext<AuthState | null>(null)

// El perfil (nombre, email, color) se guarda junto al token: asi la app abre
// al instante con lo ultimo conocido y valida la sesion por detras. Apps
// Script puede tardar de 1 a 30 s en contestar; sin esto, cada F5 mostraria
// "Cargando…" todo ese tiempo, y un fallo de red momentaneo parecia un logout.
const CLAVE_PERFIL = claveLocal('perfil')

function leerPerfilGuardado(): Usuario | null {
  try {
    const crudo = localStorage.getItem(CLAVE_PERFIL)
    return crudo && leerToken() ? (JSON.parse(crudo) as Usuario) : null
  } catch {
    return null
  }
}

function guardarPerfil(u: Usuario | null): void {
  try {
    if (u) localStorage.setItem(CLAVE_PERFIL, JSON.stringify(u))
    else localStorage.removeItem(CLAVE_PERFIL)
  } catch {
    // Sin localStorage la app igual funciona, solo que espera al servidor al abrir.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(leerPerfilGuardado)
  // Con perfil guardado no hay nada que esperar: se muestra ya y se revalida.
  const [loading, setLoading] = useState(() => leerPerfilGuardado() === null)
  const [errorConexion, setErrorConexion] = useState(false)

  // Evita que una carga de perfil vieja pise a una nueva: si mientras se
  // valida el token guardado la persona inicia sesion (u otra pestana la
  // cierra), el resultado de la carga anterior ya no vale y se descarta.
  // Ver CLAUDE.md → "La carrera de auth/perfil al montar".
  const cargaActual = useRef(0)

  const cargarPerfil = useCallback(async (): Promise<boolean> => {
    const token = ++cargaActual.current
    if (!leerToken()) {
      setUsuario(null)
      guardarPerfil(null)
      setErrorConexion(false)
      return true
    }
    try {
      const u = await gas<Usuario>('auth.yo')
      if (token !== cargaActual.current) return false
      guardarPerfil(u)
      setUsuario(u)
      setErrorConexion(false)
    } catch (e) {
      if (token !== cargaActual.current) return false
      if (e instanceof ErrorApi && e.codigo === 401) {
        // Sesion vencida o cuenta desactivada: gas() ya borro el token.
        guardarPerfil(null)
        setUsuario(null)
        setErrorConexion(false)
      } else if (leerPerfilGuardado()) {
        // Fallo de red / servidor lento: la sesion NO se pierde. Se sigue con
        // lo guardado; la siguiente accion reintenta.
        setErrorConexion(false)
      } else {
        setErrorConexion(true)
      }
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
      guardarPerfil(null)
      setUsuario(null)
    })

    // Cerrar sesion (o entrar) en una pestana se refleja en las demas.
    const claveSesion = claveLocal('sesion')
    const onStorage = (e: StorageEvent) => {
      if (e.key !== claveSesion) return
      resetearRecursos()
      setUsuario(leerPerfilGuardado())
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
      guardarPerfil(r.usuario)
      setUsuario(r.usuario)
      setErrorConexion(false)
      return { error: null }
    } catch (e) {
      return { error: mensajeDe(e, 'No se pudo iniciar sesión. Intentalo de nuevo.') }
    }
  }, [])

  const signOut = useCallback(async () => {
    // Primero se cierra de este lado: no hay que esperar a Apps Script para
    // salir, y si el servidor no contesta igual queda cerrada aca.
    const avisar = gas('auth.logout').catch(() => {})
    cargaActual.current++
    guardarToken(null)
    guardarPerfil(null)
    resetearRecursos()
    setUsuario(null)
    setErrorConexion(false)
    void avisar
  }, [])

  const refrescarPerfil = useCallback(async () => {
    await cargarPerfil()
  }, [cargarPerfil])

  const reintentar = useCallback(() => {
    setErrorConexion(false)
    setLoading(true)
    cargarPerfil().then((vigente) => {
      if (vigente) setLoading(false)
    })
  }, [cargarPerfil])

  const valor = useMemo<AuthState>(
    () => ({ usuario, loading, errorConexion, signIn, signOut, refrescarPerfil, reintentar }),
    [usuario, loading, errorConexion, signIn, signOut, refrescarPerfil, reintentar],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth tiene que usarse dentro de <AuthProvider>')
  return ctx
}
