import { crearUsuario, editarUsuario, listarUsuarios, resetearPassword, setUsuarioActivo } from '@/lib/datos'
import { crearRecurso } from '@/lib/recurso'
import type { Rol, Usuario } from '@/lib/tipos'

/**
 * Todas las cuentas del sistema. Cualquiera con sesion las ve (hace falta
 * para elegir miembros y responsables); solo un admin puede cambiarlas (la
 * Edge Function lo exige, no la interfaz). Se cachea en memoria porque casi
 * todas las pantallas la usan para mostrar nombres y avatares.
 */
const recurso = crearRecurso(listarUsuarios, 'No se pudieron cargar los usuarios.')

export function useUsuarios() {
  const estado = recurso.useRecurso()

  async function crear(datos: { nombre: string; email: string; password: string; rol: Rol }) {
    const u = await crearUsuario(datos)
    recurso.mutar((d) => [...d, u].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
    return u
  }

  async function editar(datos: { id: string; nombre: string; email: string; rol?: Rol; color?: string }) {
    const u = await editarUsuario(datos)
    recurso.mutar((d) => d.map((x) => (x.id === u.id ? u : x)))
    return u
  }

  async function setActivo(id: string, activo: boolean) {
    const u = await setUsuarioActivo(id, activo)
    recurso.mutar((d) => d.map((x) => (x.id === u.id ? u : x)))
    return u
  }

  async function cambiarPassword(id: string, password: string) {
    await resetearPassword(id, password)
  }

  return { ...estado, crear, editar, setActivo, cambiarPassword }
}

/** Mapa id → usuario, para resolver responsables y miembros sin buscar en la lista cada vez. */
export function useUsuariosPorId(): Map<string, Usuario> {
  const { data } = recurso.useRecurso()
  return new Map(data.map((u) => [u.id, u]))
}
