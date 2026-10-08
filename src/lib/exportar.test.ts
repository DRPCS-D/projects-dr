import { describe, expect, it } from 'vitest'
import { armarCSV } from './exportar'

describe('armarCSV', () => {
  it('separa con punto y coma (Excel en español) y filas con CRLF', () => {
    expect(armarCSV([['a', 1], ['b', 2]])).toBe('a;1\r\nb;2')
  })

  it('entrecomilla lo que trae separador, comillas o saltos de linea', () => {
    expect(armarCSV([['x;y', 'di "hola"', 'l1\nl2']])).toBe('"x;y";"di ""hola""";"l1\nl2"')
  })

  it('deja vacias las celdas nulas', () => {
    expect(armarCSV([[null, undefined, 0]])).toBe(';;0')
  })
})
