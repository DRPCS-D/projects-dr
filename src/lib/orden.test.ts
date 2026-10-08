import { describe, expect, it } from 'vitest'
import { comparar, opcionesDe, ordenar } from './orden'

describe('comparar', () => {
  it('ordena numeros como numeros y texto sin distinguir tildes ni mayusculas', () => {
    expect(comparar(2, 10)).toBeLessThan(0)
    expect(comparar('álvaro', 'Alvaro')).toBe(0)
    expect(comparar('item 2', 'item 10')).toBeLessThan(0)
  })
})

describe('ordenar', () => {
  const filas = [{ n: 'b' }, { n: null }, { n: 'a' }, { n: '' }]
  const valor = (f: { n: string | null }) => f.n

  it('ordena ascendente y no muta el arreglo original', () => {
    const r = ordenar(filas, { campo: 'n', dir: 'asc' }, valor)
    expect(r.slice(0, 2).map((f) => f.n)).toEqual(['a', 'b'])
    expect(filas[0].n).toBe('b')
  })

  it('manda los vacios al final en las dos direcciones', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const r = ordenar(filas, { campo: 'n', dir }, valor)
      expect(r.slice(2).every((f) => !f.n)).toBe(true)
    }
  })
})

describe('opcionesDe', () => {
  it('devuelve los valores distintos, sin vacios, ordenados', () => {
    const r = opcionesDe([{ c: 'Lima' }, { c: ' Asunción ' }, { c: 'Lima' }, { c: null }, { c: '' }], (f) => f.c)
    expect(r).toEqual(['Asunción', 'Lima'])
  })
})
