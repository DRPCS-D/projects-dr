// Gestion de usuarios, solo para admins.
//
// Existe porque crear cuentas de Auth, cambiar contrasenas o el email de
// login necesita la clave service_role, que NUNCA puede llegar al navegador.
// Todo lo demas de la app va directo a la base protegido por RLS.
//
// Seguridad: se despliega con verify_jwt desactivado y se valida a mano, para
// no depender del tipo de clave con que firma el proyecto. Cada pedido:
//   1. exige un token de sesion y lo verifica contra Supabase Auth;
//   2. lee la fila del usuario en `usuarios` (no confia en nada que mande el
//      cliente) y exige que este activo y sea admin;
// y recien despues ejecuta la accion. Un usuario comun recibe 403.
//
// Acciones (POST JSON { accion, ... }):
//   crear     { nombre, email, password, rol }
//   editar    { id, nombre, email, rol?, color? }
//   setActivo { id, activo }
//   password  { id, password }
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const COLORES = ['#1659b5', '#0f766e', '#7c3aed', '#c2410c', '#be123c', '#4d7c0f', '#0369a1', '#a16207']
const CAMPOS = 'id, nombre, email, rol, activo, color, creado_en'
const MIN_PASSWORD = 8
/** Un baneo "para siempre": Supabase Auth no tiene un flag de desactivado, solo un baneo con duracion. */
const BANEO_PERMANENTE = '876000h'

class ErrorHttp extends Error {
  status: number
  constructor(status: number, mensaje: string) {
    super(mensaje)
    this.status = status
  }
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

function validarPassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) {
    throw new ErrorHttp(400, `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`)
  }
  return p
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (req.method !== 'POST') throw new ErrorHttp(405, 'Método no permitido.')

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 1. Quien llama
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) throw new ErrorHttp(401, 'No autenticado.')
    const { data: sesion, error: errSesion } = await admin.auth.getUser(token)
    if (errSesion || !sesion.user) throw new ErrorHttp(401, 'No autenticado.')

    // 2. Su rol, leido de la base
    const { data: yo } = await admin
      .from('usuarios')
      .select('id, rol, activo')
      .eq('id', sesion.user.id)
      .maybeSingle()
    if (!yo?.activo || yo.rol !== 'admin') throw new ErrorHttp(403, 'No tenés permiso para esta operación.')

    const b = await req.json().catch(() => {
      throw new ErrorHttp(400, 'JSON inválido.')
    })

    const existente = async (id: unknown) => {
      if (typeof id !== 'string') throw new ErrorHttp(400, 'Falta el usuario.')
      const { data } = await admin.from('usuarios').select(CAMPOS).eq('id', id).maybeSingle()
      if (!data) throw new ErrorHttp(404, 'Usuario no encontrado.')
      return data
    }

    switch (b.accion) {
      case 'crear': {
        const nombre = String(b.nombre ?? '').trim()
        const email = String(b.email ?? '').trim().toLowerCase()
        const rol = b.rol === 'admin' ? 'admin' : 'usuario'
        if (!nombre) throw new ErrorHttp(400, 'El nombre es obligatorio.')
        if (!emailValido(email)) throw new ErrorHttp(400, 'El email no es válido.')
        const password = validarPassword(b.password)

        const { count } = await admin.from('usuarios').select('id', { count: 'exact', head: true })
        const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
        if (errAuth || !creado.user) {
          const duplicado = /already|registered|exists/i.test(errAuth?.message ?? '')
          throw new ErrorHttp(duplicado ? 409 : 400, duplicado ? 'Ya existe un usuario con ese email.' : 'No se pudo crear la cuenta.')
        }
        const { data, error } = await admin
          .from('usuarios')
          .insert({ id: creado.user.id, nombre, email, rol, color: COLORES[(count ?? 0) % COLORES.length] })
          .select(CAMPOS)
          .single()
        if (error) {
          // No dejar una cuenta de Auth sin perfil: quedaria un login que no entra a nada.
          await admin.auth.admin.deleteUser(creado.user.id)
          throw new ErrorHttp(500, 'No se pudo crear el usuario.')
        }
        return json(data, 201)
      }

      case 'editar': {
        const actual = await existente(b.id)
        const nombre = String(b.nombre ?? '').trim()
        const email = String(b.email ?? '').trim().toLowerCase()
        if (!nombre) throw new ErrorHttp(400, 'El nombre es obligatorio.')
        if (!emailValido(email)) throw new ErrorHttp(400, 'El email no es válido.')
        const cambios: Record<string, unknown> = { nombre, email }
        if (b.rol !== undefined) {
          if (b.rol !== 'admin' && b.rol !== 'usuario') throw new ErrorHttp(400, 'Rol inválido.')
          // Un admin no se quita a si mismo el rol: podria dejar el sistema sin ningun admin.
          if (actual.id === yo.id && b.rol !== actual.rol) throw new ErrorHttp(400, 'No podés cambiar tu propio rol.')
          cambios.rol = b.rol
        }
        if (typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color)) cambios.color = b.color

        if (email !== actual.email) {
          const { error } = await admin.auth.admin.updateUserById(actual.id, { email, email_confirm: true })
          if (error) {
            const duplicado = /already|registered|exists/i.test(error.message)
            throw new ErrorHttp(duplicado ? 409 : 400, duplicado ? 'Ya existe un usuario con ese email.' : 'No se pudo cambiar el email.')
          }
        }
        const { data, error } = await admin.from('usuarios').update(cambios).eq('id', actual.id).select(CAMPOS).single()
        if (error) throw new ErrorHttp(500, 'No se pudieron guardar los datos.')
        return json(data)
      }

      case 'setActivo': {
        const actual = await existente(b.id)
        const activo = b.activo === true
        if (!activo && actual.id === yo.id) throw new ErrorHttp(400, 'No podés desactivar tu propio usuario.')
        // El baneo corta tambien la renovacion de sesiones; la RLS ya corta el acceso a los datos.
        const { error: errAuth } = await admin.auth.admin.updateUserById(actual.id, {
          ban_duration: activo ? 'none' : BANEO_PERMANENTE,
        })
        if (errAuth) throw new ErrorHttp(500, 'No se pudo actualizar la cuenta.')
        const { data, error } = await admin.from('usuarios').update({ activo }).eq('id', actual.id).select(CAMPOS).single()
        if (error) throw new ErrorHttp(500, 'No se pudo actualizar el usuario.')
        return json(data)
      }

      case 'password': {
        const actual = await existente(b.id)
        const { error } = await admin.auth.admin.updateUserById(actual.id, { password: validarPassword(b.password) })
        if (error) throw new ErrorHttp(500, 'No se pudo cambiar la contraseña.')
        return json({ ok: true })
      }

      default:
        throw new ErrorHttp(400, 'Acción desconocida.')
    }
  } catch (e) {
    if (e instanceof ErrorHttp) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Error interno del servidor.' }, 500)
  }
})
