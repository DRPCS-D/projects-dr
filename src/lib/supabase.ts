import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Si falta el .env la app no explota: el login muestra un cartel de "falta
 * configurar". La clave es publica por diseno (viaja en el bundle): lo que
 * protege los datos es la RLS en Postgres, no esconderla.
 */
export const backendConfigurado = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
)
