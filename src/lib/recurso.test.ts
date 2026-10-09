import { describe, expect, it } from 'vitest'
import { crearRecurso, resetearRecursos, traerTodo } from './recurso'

describe('crearRecurso', () => {
  it('refetch carga, mutar cambia en memoria y resetear vacia', async () => {
    let llamadas = 0
    const r = crearRecurso(async () => {
      llamadas++
      return [1, 2, 3]
    }, 'error')
    await r.refetch()
    expect(r.get()).toEqual([1, 2, 3])
    r.mutar((d) => d.filter((x) => x !== 2))
    expect(r.get()).toEqual([1, 3])
    resetearRecursos()
    expect(r.get()).toEqual([])
    expect(llamadas).toBe(1)
  })

  it('dos refetch simultaneos comparten el mismo pedido', async () => {
    let llamadas = 0
    const r = crearRecurso(async () => {
      llamadas++
      return ['a']
    }, 'error')
    await Promise.all([r.refetch(), r.refetch()])
    expect(llamadas).toBe(1)
  })
})

describe('traerTodo', () => {
  it('pide de a paginas de 1000 hasta traer todo', async () => {
    const total = 2300
    const pedidos: Array<[number, number]> = []
    const filas = await traerTodo<number>(async (desde, hasta) => {
      pedidos.push([desde, hasta])
      const data = Array.from({ length: Math.min(hasta, total - 1) - desde + 1 }, (_, i) => desde + i)
      return { data, error: null }
    })
    expect(filas).toHaveLength(total)
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('no pide una pagina de mas cuando la ultima viene justa', async () => {
    let llamadas = 0
    await traerTodo<number>(async () => {
      llamadas++
      return { data: llamadas === 1 ? new Array(1000).fill(0) : [], error: null }
    })
    expect(llamadas).toBe(2)
  })

  it('propaga el error de la consulta', async () => {
    await expect(traerTodo(async () => ({ data: null, error: new Error('boom') }))).rejects.toThrow('boom')
  })
})
