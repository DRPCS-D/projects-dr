import { describe, expect, it } from 'vitest'
import { crearRecurso, resetearRecursos } from './recurso'

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
