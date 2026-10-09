/**
 * Reconocer enlaces dentro de un texto libre (la descripcion de una tarea).
 *
 * Solo http/https (y `www.` a secas, que se completa con https). No se tocan
 * emails ni `javascript:`/`ftp:`/etc.: el texto NUNCA se interpreta como HTML,
 * quien dibuja arma elementos de React con estas partes, asi que un texto
 * hostil no puede inyectar nada.
 */

export type Parte = { texto: string; url?: undefined } | { texto: string; url: string }

export interface Enlace {
  /** URL completa y normalizada, lista para un href. */
  url: string
  /** 'www.ejemplo.com' → 'ejemplo.com' */
  dominio: string
  /** El enlace sin protocolo ni 'www.' ni barra final, para mostrar. */
  visible: string
}

const PATRON = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi

/** Signos que se pegan al final de un link dentro de una oracion: "mira https://x.com." */
const FINALES = new Set(['.', ',', ';', ':', '!', '?', '…', "'", '"'])
const CIERRES: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * Saca del final lo que es de la oracion y no del enlace: puntuacion, y un
 * parentesis de cierre solo si NO tiene su apertura dentro del enlace (asi
 * `(ver https://x.com/a)` pierde el `)`, pero la URL de Wikipedia
 * `.../Foo_(bar)` lo conserva).
 */
function recortar(candidato: string): string {
  let c = candidato
  for (;;) {
    const ultimo = c.at(-1)
    if (!ultimo) return c
    if (FINALES.has(ultimo)) {
      c = c.slice(0, -1)
      continue
    }
    const apertura = CIERRES[ultimo]
    if (apertura) {
      const abiertos = c.split(apertura).length - 1
      const cerrados = c.split(ultimo).length - 1
      if (cerrados > abiertos) {
        c = c.slice(0, -1)
        continue
      }
    }
    return c
  }
}

function aUrl(texto: string): URL | null {
  const conProtocolo = /^www\./i.test(texto) ? `https://${texto}` : texto
  try {
    const u = new URL(conProtocolo)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // "http://algo" sin punto no es un enlace de los que se pegan a mano.
    if (!u.hostname.includes('.')) return null
    return u
  } catch {
    return null
  }
}

/** Parte el texto en trozos de texto plano y enlaces, en orden, sin perder ni un caracter. */
export function partirEnlaces(texto: string): Parte[] {
  const partes: Parte[] = []
  const agregarTexto = (t: string) => {
    if (!t) return
    const ultima = partes.at(-1)
    if (ultima && !ultima.url) ultima.texto += t
    else partes.push({ texto: t })
  }

  let desde = 0
  for (const m of texto.matchAll(PATRON)) {
    const inicio = m.index ?? 0
    const candidato = recortar(m[0])
    const url = aUrl(candidato)
    if (!url) continue
    agregarTexto(texto.slice(desde, inicio))
    partes.push({ texto: candidato, url: url.href })
    desde = inicio + candidato.length
  }
  agregarTexto(texto.slice(desde))
  return partes
}

/** Enlaces del texto, sin repetir, en el orden en que aparecen. */
export function extraerEnlaces(texto: string): Enlace[] {
  const vistos = new Set<string>()
  const enlaces: Enlace[] = []
  for (const p of partirEnlaces(texto)) {
    if (!p.url || vistos.has(p.url)) continue
    vistos.add(p.url)
    const u = new URL(p.url)
    enlaces.push({
      url: p.url,
      dominio: u.hostname.replace(/^www\./i, ''),
      visible: p.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''),
    })
  }
  return enlaces
}
