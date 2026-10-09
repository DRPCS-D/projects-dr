import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { armarBundle, ORDEN, SALIDA } from '../../scripts/gas-bundle.mjs'

describe('backend en un solo archivo', () => {
  it('esta al dia con los fuentes (si falla: npm run gas:bundle)', () => {
    expect(readFileSync(SALIDA, 'utf8')).toBe(armarBundle())
  })

  it('incluye todos los .js de apps-script/', () => {
    const fuentes = readdirSync(path.dirname(SALIDA) + '/../apps-script').filter((f) => f.endsWith('.js'))
    expect([...ORDEN].sort()).toEqual(fuentes.sort())
  })

  it('compila sin declaraciones repetidas y define el punto de entrada', () => {
    const ctx = vm.createContext({})
    vm.runInContext(armarBundle(), ctx)
    expect(typeof ctx.doPost).toBe('function')
    expect(typeof ctx.setup).toBe('function')
  })
})
