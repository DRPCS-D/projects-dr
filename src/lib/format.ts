/** Formateo y validaciones con las convenciones paraguayas. */

/** '2026-03-14' → '14/03/2026'. Recorta la hora si viene un timestamp. */
export function formatFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [fecha] = iso.split('T')
  const [a, m, d] = fecha.split('-')
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

export function formatFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return '—'
  return `${formatFecha(iso)} ${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`
}

/**
 * Digito verificador del RUC, algoritmo modulo 11 de la SET.
 * Los RUC viejos podian traer letras: se convierten a su codigo ASCII.
 *
 * ADVERTENCIA: esto sirve para AVISAR, nunca para bloquear. Si el algoritmo
 * tuviera un detalle mal, rechazar un RUC valido seria peor que no avisar.
 * Ver `rucSospechoso`.
 */
export function calcularDV(rucSinDV: string, baseMax = 11): number | null {
  const limpio = String(rucSinDV).trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!limpio) return null

  let digitos = ''
  for (const c of limpio) {
    digitos += c >= '0' && c <= '9' ? c : String(c.charCodeAt(0))
  }

  let total = 0
  let k = 2
  for (let i = digitos.length - 1; i >= 0; i--) {
    if (k > baseMax) k = 2
    total += Number(digitos[i]) * k
    k++
  }
  const resto = total % 11
  return resto > 1 ? 11 - resto : 0
}

/**
 * true si el RUC tiene forma '80012345-6' y el DV NO cierra.
 * Se usa solo para pintar una advertencia al lado del campo; el guardado
 * nunca se frena por esto. Un RUC sin guion no se considera sospechoso
 * porque simplemente no se puede evaluar.
 */
export function rucSospechoso(ruc: string | null | undefined): boolean {
  if (!ruc) return false
  const m = String(ruc).trim().match(/^([0-9A-Za-z]+)-(\d)$/)
  if (!m) return false
  return calcularDV(m[1]) !== Number(m[2])
}

/** '800123456' → '80012345-6'. Deja intacto lo que ya trae guion. */
export function formatRuc(ruc: string | null | undefined): string {
  if (!ruc) return '—'
  const s = String(ruc).trim()
  if (s.includes('-')) return s
  const d = s.replace(/\D/g, '')
  if (d.length < 2) return s
  return `${d.slice(0, -1)}-${d.slice(-1)}`
}

/** Compara RUCs ignorando guiones y espacios. */
export function mismoRuc(a: string | null | undefined, b: string | null | undefined): boolean {
  const limpiar = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')
  const x = limpiar(a)
  return x.length > 0 && x === limpiar(b)
}

/** Normaliza texto para buscar sin tildes ni mayusculas. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
}
