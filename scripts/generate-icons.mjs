// Genera el logo SVG y los PNG de iconos de la PWA. Se corre a mano cuando
// el logo cambia (no es parte del build normal):
//
//   npm install --no-save sharp
//   npm run iconos
//
// Para cambiar el logo: el color sale de `colorPrimario` en app.config.json (de
// donde sale tambien el theme-color de index.html y del manifest, asi que no se
// pueden desincronizar), la forma es el GLYPH de aca. Despues, volver a correrlo.
import sharp from 'sharp'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const { colorPrimario: PRIMARY } = JSON.parse(readFileSync('app.config.json', 'utf-8'))

// Logo de InitialD: una D sólida con las columnas de un tablero Kanban
// recortadas en blanco dentro, sobre un fondo blanco con borde azul.
// Coordenadas para un viewBox de 100x100, con el contenido dentro del 80%
// central para respetar el "safe zone" de los iconos maskable.
const BLANCO = '#ffffff'
const GLYPH = `
  <path d="M24 22 H46 A28 28 0 0 1 46 78 H24 Z" fill="${PRIMARY}" stroke="${PRIMARY}" stroke-width="4" stroke-linejoin="round"/>
  <rect x="31" y="33" width="7" height="34" rx="3.5" fill="${BLANCO}"/>
  <rect x="42.5" y="33" width="7" height="24" rx="3.5" fill="${BLANCO}" opacity="0.85"/>
  <rect x="54" y="33" width="7" height="14" rx="3.5" fill="${BLANCO}" opacity="0.7"/>
`.trim()

function svg({ rounded }) {
  // Con esquinas redondeadas lleva borde azul (sobre blanco, si no, se pierde
  // contra una pagina clara). El maskable va a pleno color y sin borde: el
  // sistema operativo lo recorta con su propia forma.
  const bg = rounded
    ? `<rect x="1.5" y="1.5" width="97" height="97" rx="21" fill="${BLANCO}" stroke="${PRIMARY}" stroke-width="3"/>`
    : `<rect width="100" height="100" fill="${BLANCO}"/>`
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${bg}${GLYPH}</svg>`
}

const SVG_ROUNDED = svg({ rounded: true })
const SVG_SQUARE = svg({ rounded: false })

mkdirSync('public/icons', { recursive: true })

writeFileSync('public/logo.svg', SVG_ROUNDED)
writeFileSync('public/favicon.svg', SVG_ROUNDED)

const trabajos = [
  { svg: SVG_ROUNDED, size: 32, out: 'public/favicon-32.png' },
  { svg: SVG_ROUNDED, size: 180, out: 'public/icons/apple-touch-icon.png' },
  { svg: SVG_ROUNDED, size: 192, out: 'public/icons/icon-192.png' },
  { svg: SVG_ROUNDED, size: 512, out: 'public/icons/icon-512.png' },
  { svg: SVG_SQUARE, size: 512, out: 'public/icons/icon-512-maskable.png' },
]

for (const t of trabajos) {
  await sharp(Buffer.from(t.svg)).resize(t.size, t.size).png().toFile(t.out)
  console.log('OK', t.out)
}
