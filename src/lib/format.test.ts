import { describe, expect, it } from 'vitest'
import { calcularDV, formatFecha, formatRuc, mismoRuc, normalizar, rucSospechoso } from './format'

describe('formatFecha', () => {
  it('pasa de ISO a dd/mm/aaaa', () => {
    expect(formatFecha('2026-08-03')).toBe('03/08/2026')
  })

  it('recorta la hora de un timestamp', () => {
    expect(formatFecha('2026-08-03T15:30:00Z')).toBe('03/08/2026')
  })

  it('muestra un guion cuando no hay fecha', () => {
    expect(formatFecha(null)).toBe('—')
  })
})

describe('RUC', () => {
  it('valida el DV de RUCs reales', () => {
    expect(rucSospechoso('80137878-8')).toBe(false)
    expect(rucSospechoso('80119851-8')).toBe(false)
  })

  it('marca como sospechoso un DV que no cierra', () => {
    expect(rucSospechoso('80137878-1')).toBe(true)
  })

  it('no opina sobre un RUC sin guion', () => {
    // No se puede evaluar, asi que no se avisa nada
    expect(rucSospechoso('801378788')).toBe(false)
    expect(rucSospechoso('')).toBe(false)
  })

  it('calcula el DV', () => {
    expect(calcularDV('80137878')).toBe(8)
    expect(calcularDV('')).toBeNull()
  })

  it('formatea con guion', () => {
    expect(formatRuc('801378788')).toBe('80137878-8')
    expect(formatRuc('80137878-8')).toBe('80137878-8')
    expect(formatRuc(null)).toBe('—')
  })

  it('compara ignorando guiones', () => {
    expect(mismoRuc('80137878-8', '801378788')).toBe(true)
    expect(mismoRuc('80137878-8', '80119851-8')).toBe(false)
    expect(mismoRuc('', '')).toBe(false)
  })
})

describe('normalizar', () => {
  it('saca tildes y mayusculas para poder buscar', () => {
    expect(normalizar('Categoría')).toBe('categoria')
  })

  it('tambien convierte la ñ en n', () => {
    // Efecto de descomponer en NFD y sacar todos los diacriticos. Es lo que
    // se busca: escribiendo "nandu" se encuentra "ñandú".
    expect(normalizar('  ÑANDÚ ')).toBe('nandu')
  })
})
