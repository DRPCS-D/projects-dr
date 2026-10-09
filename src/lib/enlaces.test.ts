import { describe, expect, it } from 'vitest'
import { extraerEnlaces, partirEnlaces } from './enlaces'

const soloEnlaces = (t: string) => partirEnlaces(t).filter((p) => p.url).map((p) => p.texto)

describe('partirEnlaces', () => {
  it('un texto sin enlaces queda intacto', () => {
    expect(partirEnlaces('hola mundo')).toEqual([{ texto: 'hola mundo' }])
    expect(partirEnlaces('')).toEqual([])
  })

  it('reconoce https, http y www, y completa www con https', () => {
    expect(partirEnlaces('https://a.com y http://b.com y www.c.com')).toEqual([
      { texto: 'https://a.com', url: 'https://a.com/' },
      { texto: ' y ', url: undefined },
      { texto: 'http://b.com', url: 'http://b.com/' },
      { texto: ' y ', url: undefined },
      { texto: 'www.c.com', url: 'https://www.c.com/' },
    ])
  })

  it('no pierde ni un caracter: unir las partes devuelve el texto original', () => {
    const t = 'Mirá https://a.com/x?y=1#z, luego (www.b.com/p) y listo.\nOtra línea https://c.org.'
    expect(partirEnlaces(t).map((p) => p.texto).join('')).toBe(t)
  })

  it('la puntuacion de la oracion no es parte del enlace', () => {
    expect(soloEnlaces('Ver https://a.com.')).toEqual(['https://a.com'])
    expect(soloEnlaces('¿Viste https://a.com/b?')).toEqual(['https://a.com/b'])
    expect(soloEnlaces('a https://a.com, b')).toEqual(['https://a.com'])
    expect(soloEnlaces('"https://a.com"')).toEqual(['https://a.com'])
  })

  it('un parentesis de cierre sobrante se descarta, pero uno que cierra el del enlace se conserva', () => {
    expect(soloEnlaces('(ver https://a.com/x)')).toEqual(['https://a.com/x'])
    expect(soloEnlaces('https://es.wikipedia.org/wiki/Foo_(bar)')).toEqual(['https://es.wikipedia.org/wiki/Foo_(bar)'])
    expect(soloEnlaces('(https://es.wikipedia.org/wiki/Foo_(bar))')).toEqual(['https://es.wikipedia.org/wiki/Foo_(bar)'])
  })

  it('conserva parametros, hash y caracteres no ASCII de la ruta', () => {
    expect(soloEnlaces('https://a.com/ruta/ñandú?x=1&y=2#sec')).toEqual(['https://a.com/ruta/ñandú?x=1&y=2#sec'])
  })

  it('solo http y https: nada de javascript:, ftp:, data: ni emails', () => {
    expect(soloEnlaces('javascript:alert(1) ftp://a.com data:text/html,hola juan@a.com')).toEqual([])
    expect(soloEnlaces('<a href="javascript:alert(1)">x</a>')).toEqual([])
  })

  it('un host sin punto o una URL rota no es un enlace', () => {
    expect(soloEnlaces('http://localhost y https:// y www.')).toEqual([])
  })

  it('el HTML se trata como texto: nunca se interpreta', () => {
    const t = '<img src=x onerror=alert(1)> https://a.com <script>x</script>'
    const partes = partirEnlaces(t)
    expect(partes.map((p) => p.texto).join('')).toBe(t)
    expect(partes.filter((p) => p.url)).toHaveLength(1)
  })
})

describe('extraerEnlaces', () => {
  it('quita repetidos, respeta el orden y arma el texto para mostrar', () => {
    expect(extraerEnlaces('https://www.a.com/x/ y https://b.org y https://www.a.com/x/')).toEqual([
      { url: 'https://www.a.com/x/', dominio: 'a.com', visible: 'a.com/x' },
      { url: 'https://b.org/', dominio: 'b.org', visible: 'b.org' },
    ])
  })

  it('sin enlaces, lista vacia', () => {
    expect(extraerEnlaces('nada por aca')).toEqual([])
  })
})
