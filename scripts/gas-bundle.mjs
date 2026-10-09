/**
 * Junta los archivos de `apps-script/` en uno solo: `apps-script-un-archivo/Codigo.js`.
 *
 * Es para instalar el backend copiando y pegando en el editor web de Apps
 * Script sin `clasp`: un unico archivo "Codigo" en vez de siete, asi no hay
 * forma de pegar uno dos veces o en el lugar equivocado. Se regenera con
 * `npm run gas:bundle`; un test (apps-script/tests/bundle.test.mjs) falla si
 * quedo desactualizado respecto de los archivos fuente.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(raiz, 'apps-script')

// Db primero (define ESQUEMA y ErrorApp, que el resto usa).
export const ORDEN = ['Db.js', 'Auth.js', 'Usuarios.js', 'Proyectos.js', 'Tareas.js', 'Router.js', 'Setup.js']
export const SALIDA = path.join(raiz, 'apps-script-un-archivo', 'Codigo.js')

export function armarBundle() {
  const partes = ORDEN.map((archivo) => {
    const codigo = readFileSync(path.join(DIR, archivo), 'utf8').replace(/\r\n/g, '\n').trimEnd()
    return `// ═════════ ${archivo} ═════════\n\n${codigo}\n`
  })
  return (
    '// Backend de Proyectos DR en UN solo archivo, generado con `npm run gas:bundle`.\n' +
    '// No editar a mano: los fuentes estan en apps-script/. Pegar entero en un\n' +
    '// archivo "Codigo" del editor de Apps Script (y que no haya ningun otro .gs).\n\n' +
    partes.join('\n')
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(path.dirname(SALIDA), { recursive: true })
  writeFileSync(SALIDA, armarBundle())
  console.log('Generado', path.relative(raiz, SALIDA))
}
