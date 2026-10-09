import type { Session } from '@supabase/supabase-js'
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
import { miPerfil } from '@/lib/datos'
import { esSinConexion, mensajeDe } from '@/lib/errores'
import { resetearRecursos } from '@/lib/recurso'
import { supabase } from '@/lib/supabase'
import type { Usuario } from '@/lib/tipos'

interface AuthState {
  session: Session | null
  /** Mi fila de `usuarios` (nombre, rol...). Null si no hay sesion o no se pudo cargar. */
  usuario: Usuario | null
  /** Roles: 'admin' gestiona usuarios. No da acceso a proyectos ajenos. */
  esAdmin: boolean
  loading: boolean
  /**
   * Hay sesion valida pero algo impide usar la app:
   * - 'sin-perfil': existe la cuenta de Auth pero nadie la dio de alta en
   *   `usuarios` (por ejemplo, se creo a mano en el panel de Supabase).
   * - 'inactivo': el usuario esta desactivado.
   * Sin esto, la pantalla queda en blanco en vez de explicar por que.
   */
  problemaPerfil: 'sin-perfil' | 'inactivo' | null
  /**
   * No se pudo hablar con el servidor al cargar el perfil. Es distinto de "sin
   * sesion": la sesion sigue guardada, asi que se ofrece reintentar y no se
   * manda al login.
   */
  errorConexion: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refrescarPerfil: () => Promise<void>
  reintentar: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [problemaPerfil, setProblemaPerfil] = useState<AuthState['problemaPerfil']>(null)
  const [errorConexion, setErrorConexion] = useState(false)
  const [loading, setLoading] = useState(true)

  // Evita que una carga de perfil vieja pise a una nueva al cambiar de sesion
  const cargaActual = useRef(0)

  /**
   * Devuelve si esta carga seguia siendo la vigente al terminar (su token no
   * fue superado por otra mas nueva). Al montar la app se disparan dos cargas
   * casi simultaneas para el mismo usuario -- el INITIAL_SESSION que emite
   * onAuthStateChange al suscribirse, y el getSession() inicial -- y sin este
   * valor la perdedora apagaba el loading con el perfil todavia en null: el
   * layout veia loading=false + usuario=null y redirigia al login por creer
   * que no habia sesion, justo antes de que la ganadora escribiera los datos.
   * Pasaba siempre entrando por URL directa o F5, nunca navegando con links.
   */
  const cargarPerfil = useCallback(async (userId: string | undefined): Promise<boolean> => {
    const token = ++cargaActual.current

    if (!userId) {
      setUsuario(null)
      setProblemaPerfil(null)
      setErrorConexion(false)
      return true
    }

    try {
      const perfil = await miPerfil(userId)
      if (token !== cargaActual.current) return false
      setErrorConexion(false)
      setUsuario(perfil)
      setProblemaPerfil(!perfil ? 'sin-perfil' : !perfil.activo ? 'inactivo' : null)
    } catch (e) {
      if (token !== cargaActual.current) return false
      setUsuario(null)
      setProblemaPerfil(null)
      // Sin red no es "cuenta sin configurar": no hay que decirle eso a nadie.
      setErrorConexion(esSinConexion(e))
      if (!esSinConexion(e)) setProblemaPerfil('sin-perfil')
    }
    return true
  }, [])

  useEffect(() => {
    let vivo = true
    // Compara el usuario, no el nombre del evento: supabase-js revalida la
    // sesion cada vez que la pestana recupera el foco, y segun la version eso
    // puede disparar 'SIGNED_IN' (no solo 'TOKEN_REFRESHED') aunque sea el
    // mismo usuario de siempre. Si a eso se le hace setLoading(true), el
    // AppLayout desmonta el Outlet y se pierde cualquier formulario a medio
    // llenar. Reaccionar solo a un cambio real de usuario evita el problema
    // sin depender de que lista de eventos haya que ignorar.
    const usuarioIdAnterior = { current: undefined as string | undefined }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      usuarioIdAnterior.current = data.session?.user?.id
      setSession(data.session)
      const vigente = await cargarPerfil(data.session?.user?.id)
      if (vivo && vigente) setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_evento, nuevaSesion) => {
      if (!vivo) return
      setSession(nuevaSesion)

      const idNuevo = nuevaSesion?.user?.id
      if (idNuevo === usuarioIdAnterior.current) return
      usuarioIdAnterior.current = idNuevo

      // Otra persona (o ninguna) en el mismo dispositivo: lo cacheado en
      // memoria era de la anterior y no tiene que verse ni un instante.
      resetearRecursos()
      setLoading(true)
      const vigente = await cargarPerfil(idNuevo)
      if (vivo && vigente) setLoading(false)
    })

    return () => {
      vivo = false
      subscription.unsubscribe()
    }
  }, [cargarPerfil])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    // No se expone el mensaje crudo de Supabase: filtra si el email existe o no
    if (error) {
      if (/invalid login|credentials/i.test(error.message)) return { error: 'Email o contraseña incorrectos.' }
      if (/banned/i.test(error.message)) return { error: 'Tu usuario fue desactivado. Contactá a un administrador.' }
      return { error: mensajeDe(error, 'No se pudo iniciar sesión. Intentalo de nuevo.') }
    }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    resetearRecursos()
    setUsuario(null)
    setProblemaPerfil(null)
    setErrorConexion(false)
  }, [])

  const refrescarPerfil = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await cargarPerfil(data.session?.user?.id)
  }, [cargarPerfil])

  const reintentar = useCallback(() => {
    setErrorConexion(false)
    setLoading(true)
    supabase.auth.getSession().then(async ({ data }) => {
      const vigente = await cargarPerfil(data.session?.user?.id)
      if (vigente) setLoading(false)
    })
  }, [cargarPerfil])

  const valor = useMemo<AuthState>(
    () => ({
      session,
      usuario,
      esAdmin: usuario?.rol === 'admin' && usuario.activo,
      loading,
      problemaPerfil,
      errorConexion,
      signIn,
      signOut,
      refrescarPerfil,
      reintentar,
    }),
    [session, usuario, loading, problemaPerfil, errorConexion, signIn, signOut, refrescarPerfil, reintentar],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth tiene que usarse dentro de <AuthProvider>')
  return ctx
}
