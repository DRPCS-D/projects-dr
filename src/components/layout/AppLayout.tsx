import { CheckSquare, FolderKanban, House, KeyRound, LogOut, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CambiarMiPasswordModal } from '@/components/cuenta/CambiarMiPasswordModal'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Cargando } from '@/components/ui/estado'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useAuth } from '@/hooks/useAuth'
import { APP_NOMBRE } from '@/lib/app'
import { cn } from '@/lib/utils'

// Un solo nivel de usuario: todos ven el mismo menu.
const NAV = [
  { to: '/', label: 'Inicio', end: true, icono: House },
  { to: '/proyectos', label: 'Proyectos', end: false, icono: FolderKanban },
  { to: '/mis-tareas', label: 'Mis tareas', end: false, icono: CheckSquare },
  { to: '/usuarios', label: 'Usuarios', end: false, icono: Users },
]

export default function AppLayout() {
  const { usuario, loading, errorConexion, signOut, reintentar } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [modalPassword, setModalPassword] = useState(false)

  useEffect(() => {
    // Un fallo de conexion no es "sin sesion": no se manda al login.
    if (!loading && !usuario && !errorConexion) navigate('/login', { replace: true })
  }, [usuario, loading, errorConexion, navigate])

  if (loading) return <Cargando className="min-h-screen" texto="Cargando tu cuenta…" />
  if (!usuario && errorConexion) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-xs">
          <h1 className="text-sm font-semibold text-foreground">No se pudo conectar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El servidor no respondió. Tu sesión sigue abierta: probá de nuevo en unos segundos.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={reintentar}>Reintentar</Button>
            <Button variant="outline" onClick={signOut}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </div>
    )
  }
  if (!usuario) return null

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-2">
            <img src="/logo.svg" alt="" className="size-7 shrink-0 rounded-md" />
            <span className="truncate text-sm font-semibold text-foreground">{APP_NOMBRE}</span>
          </NavLink>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <div className="text-right">
                <p className="text-xs font-medium text-foreground">{usuario.nombre}</p>
                <p className="text-[11px] text-muted-foreground">{usuario.email}</p>
              </div>
              <Avatar usuario={usuario} tamano="md" />
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => setModalPassword(true)} title="Cambiar mi contraseña">
              <KeyRound />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} title="Cerrar sesión">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-5 sm:px-6 md:pb-10 md:pt-8">
        {/* Con `key`, un error de dibujo se limpia al cambiar de seccion. */}
        <ErrorBoundary key={pathname.split('/')[1]}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Navegacion en mobile: barra fija abajo, al alcance del pulgar */}
      <nav
        id="nav-inferior"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map(({ to, label, end, icono: Icono }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px]',
                isActive ? 'font-medium text-primary' : 'text-muted-foreground',
              )
            }
          >
            <Icono className="size-5" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <CambiarMiPasswordModal abierto={modalPassword} onCerrar={() => setModalPassword(false)} />
    </div>
  )
}
