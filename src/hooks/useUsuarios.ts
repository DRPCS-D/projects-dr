import { gas } from '@/lib/api'
import { crearRecurso } from '@/lib/recurso'
import type { Usuario } from '@/lib/tipos'

/**
 * Todas las cuentas del sistema. Hay un solo nivel de usuario: cualquiera
 * con sesion las ve (hace falta para elegir miembros y responsables) y las
 * gestiona. Se cachea en memoria porque casi todas las pantallas la usan
 * para mostrar nombres y avatares.
 */
const recurso = crearRecurso(() => gas<Usuario[]>('usuarios.listar'), 'No se pudieron cargar los usuarios.')

export function useUsuarios() {
  const estado = recurso.useRecurso()

  async function crear(datos: { nombre: string; email: string; password: string }) {
    const u = await gas<Usuario>('usuarios.crear', datos)
    recurso.mutar((d) => [...d, u])
    return u
  }

  async function editar(datos: { id: string; nombre: string; email: string; color?: string }) {
    const u = await gas<Usuario>('usuarios.editar', datos)
    recurso.mutar((d) => d.map((x) => (x.id === u.id ? u : x)))
    return u
  }

  async function setActivo(id: string, activo: boolean) {
    const u = await gas<Usuario>('usuarios.setActivo', { id, activo })
    recurso.mutar((d) => d.map((x) => (x.id === u.id ? u : x)))
    return u
  }

  async function cambiarPassword(id: string, password: string) {
    await gas('usuarios.password', { id, password })
  }

  return { ...estado, crear, editar, setActivo, cambiarPassword }
}

/** Mapa id → usuario, para resolver responsables y miembros sin buscar en la lista cada vez. */
export function useUsuariosPorId(): Map<string, Usuario> {
  const { data } = recurso.useRecurso()
  return new Map(data.map((u) => [u.id, u]))
}
