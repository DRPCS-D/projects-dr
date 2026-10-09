import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorApi, gas, SIN_CONEXION } from './api'

const ok = (data: unknown) => ({ json: async () => ({ ok: true, data }) })
const falloDeRed = () => Promise.reject(new TypeError('Failed to fetch'))

describe('gas()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('una lectura que falla por la red se reintenta y termina funcionando', async () => {
    const fetchMock = vi.fn().mockImplementationOnce(falloDeRed).mockImplementationOnce(falloDeRed).mockResolvedValueOnce(ok([1, 2]))
    vi.stubGlobal('fetch', fetchMock)
    const p = gas<number[]>('proyectos.listar')
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).resolves.toEqual([1, 2])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('una lectura se rinde tras los reintentos con codigo SIN_CONEXION', async () => {
    const fetchMock = vi.fn().mockImplementation(falloDeRed)
    vi.stubGlobal('fetch', fetchMock)
    const p = gas('tareas.mias')
    const resultado = p.then(
      () => null,
      (e) => e,
    )
    await vi.advanceTimersByTimeAsync(5000)
    const e = await resultado
    expect(e).toBeInstanceOf(ErrorApi)
    expect(e.codigo).toBe(SIN_CONEXION)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 intento + 2 reintentos
  })

  it('una escritura NO se reintenta (podria duplicar la tarea)', async () => {
    const fetchMock = vi.fn().mockImplementation(falloDeRed)
    vi.stubGlobal('fetch', fetchMock)
    await expect(gas('tareas.crear', { titulo: 'x' })).rejects.toMatchObject({ codigo: SIN_CONEXION })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('una respuesta que no es JSON (pagina de error de Google) cuenta como sin conexion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => Promise.reject(new SyntaxError('Unexpected token <')) }))
    await expect(gas('tareas.editar', {})).rejects.toMatchObject({ codigo: SIN_CONEXION })
  })

  it('503 (candado ocupado) se reintenta tambien en escrituras: la accion no llego a ejecutarse', async () => {
    const ocupado = { json: async () => ({ ok: false, error: 'El servidor está ocupado.', codigo: 503 }) }
    const fetchMock = vi.fn().mockResolvedValueOnce(ocupado).mockResolvedValueOnce(ocupado).mockResolvedValueOnce(ok({ id: 't1' }))
    vi.stubGlobal('fetch', fetchMock)
    const p = gas<{ id: string }>('tareas.crear', { titulo: 'x' })
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(p).resolves.toEqual({ id: 't1' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('si el candado sigue ocupado tras los reintentos, falla con el 503', async () => {
    const ocupado = { json: async () => ({ ok: false, error: 'El servidor está ocupado.', codigo: 503 }) }
    const fetchMock = vi.fn().mockResolvedValue(ocupado)
    vi.stubGlobal('fetch', fetchMock)
    const resultado = gas('tareas.crear', {}).then(
      () => null,
      (e) => e,
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await resultado).toMatchObject({ codigo: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('un error del servidor (ej. 401) no se reintenta y conserva su mensaje y codigo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: 'No autenticado.', codigo: 401 }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(gas('proyectos.listar')).rejects.toMatchObject({ codigo: 401, message: 'No autenticado.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
