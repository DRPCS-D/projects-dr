import { Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ErrorBox } from '@/components/ui/estado'
import { Field, Input } from '@/components/ui/field'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { useAuth } from '@/hooks/useAuth'
import { APP_CREDITO, APP_NOMBRE, APP_VERSION } from '@/lib/app'
import { backendConfigurado } from '@/lib/supabase'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!loading && session) navigate('/', { replace: true })
  }, [session, loading, navigate])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (enviando) return
    setError(null)
    setEnviando(true)
    const { error: err } = await signIn(email, password)
    setEnviando(false)
    if (err) setError(err)
    else navigate('/', { replace: true })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="absolute right-3 top-3">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <img src="/logo.svg" alt="" className="mx-auto mb-3 size-12" />
          <h1 className="text-lg font-semibold text-foreground">{APP_NOMBRE}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ingresá con tu cuenta</p>
        </div>

        {!backendConfigurado && (
          <div className="mb-4">
            <ErrorBox mensaje="Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo .env" />
          </div>
        )}

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-xs"
        >
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@ejemplo.com"
              autoComplete="email"
              required
              autoFocus
            />
          </Field>

          <Field label="Contraseña">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>

          {error && <ErrorBox mensaje={error} />}

          <Button type="submit" className="w-full" disabled={enviando || !backendConfigurado}>
            {enviando ? (
              <>
                <Loader2 className="animate-spin" /> Ingresando…
              </>
            ) : (
              'Ingresar'
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          ¿No tenés cuenta? Pedísela a alguien del equipo.
        </p>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
          {APP_CREDITO && <>{APP_CREDITO} · </>}v{APP_VERSION}
        </p>
      </div>
    </div>
  )
}
