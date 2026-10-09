/**
 * Pruebas del backend de Apps Script, corriendo el codigo REAL de
 * `apps-script/*.js` contra un Sheet en memoria (scripts/gas-local.mjs).
 *
 * Lo central es el aislamiento por proyecto: alguien que no es miembro no
 * puede leer ni tocar nada de un proyecto, ni siquiera llamando a la accion
 * directo con un id valido. Es el equivalente a la suite pgTAP de app-base.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { crearGasLocal } from '../../scripts/gas-local.mjs'

let gas
let tokenAna, tokenBeto, tokenCarla
let ana, beto, carla

function llamar(accion, datos, token) {
  return gas.manejar({ accion, datos, token })
}
function ok(accion, datos, token) {
  const r = llamar(accion, datos, token)
  if (!r.ok) throw new Error(`${accion}: ${r.error}`)
  return r.data
}
function login(email, password) {
  return ok('auth.login', { email, password })
}

beforeEach(() => {
  gas = crearGasLocal({}, { silencioso: true, email: 'ana@test.local' })
  gas.setProp('SETUP_PASSWORD', 'clave-ana-1')
  gas.setProp('SETUP_NOMBRE', 'Ana')
  gas.setup()
  ;({ token: tokenAna, usuario: ana } = login('ana@test.local', 'clave-ana-1'))
  beto = ok('usuarios.crear', { nombre: 'Beto', email: 'beto@test.local', password: 'clave-beto-1' }, tokenAna)
  carla = ok('usuarios.crear', { nombre: 'Carla', email: 'carla@test.local', password: 'clave-carla-1' }, tokenAna)
  tokenBeto = login('beto@test.local', 'clave-beto-1').token
  tokenCarla = login('carla@test.local', 'clave-carla-1').token
})

describe('setup', () => {
  it('crea una hoja por tabla con sus encabezados', () => {
    expect(gas.hoja('Tareas')[0]).toContain('fecha_vencimiento')
    expect(gas.hoja('Usuarios')).toHaveLength(4) // encabezado + 3
  })

  it('es idempotente: correrlo de nuevo no duplica nada', () => {
    gas.setup()
    expect(gas.hoja('Usuarios')).toHaveLength(4)
  })
})

describe('auth', () => {
  it('nunca guarda la contraseña en claro ni la devuelve', () => {
    const fila = gas.hoja('Usuarios').find((f) => f.includes('beto@test.local'))
    expect(fila.join('|')).not.toContain('clave-beto-1')
    expect(beto).not.toHaveProperty('password_hash')
    expect(beto).not.toHaveProperty('salt')
  })

  it('rechaza una contraseña incorrecta con un mensaje que no revela si el email existe', () => {
    const r1 = llamar('auth.login', { email: 'beto@test.local', password: 'otra-clave' })
    const r2 = llamar('auth.login', { email: 'nadie@test.local', password: 'otra-clave' })
    expect(r1.ok).toBe(false)
    expect(r1.error).toBe(r2.error)
  })

  it('el email no distingue mayusculas', () => {
    expect(login('  BETO@test.local ', 'clave-beto-1').usuario.id).toBe(beto.id)
  })

  it('bloquea tras 5 intentos fallidos', () => {
    for (let i = 0; i < 5; i++) llamar('auth.login', { email: 'beto@test.local', password: 'mal' })
    const r = llamar('auth.login', { email: 'beto@test.local', password: 'clave-beto-1' })
    expect(r.codigo).toBe(429)
  })

  it('sin token o con token inventado contesta 401', () => {
    expect(llamar('proyectos.listar', {}).codigo).toBe(401)
    expect(llamar('proyectos.listar', {}, 'inventado').codigo).toBe(401)
  })

  it('logout invalida el token', () => {
    ok('auth.logout', {}, tokenBeto)
    expect(llamar('auth.yo', {}, tokenBeto).codigo).toBe(401)
  })

  it('desactivar a alguien corta su sesion en la proxima llamada', () => {
    ok('usuarios.setActivo', { id: beto.id, activo: false }, tokenAna)
    expect(llamar('auth.yo', {}, tokenBeto).codigo).toBe(401)
    expect(llamar('auth.login', { email: 'beto@test.local', password: 'clave-beto-1' }).ok).toBe(false)
  })

  it('nadie puede desactivarse a si mismo', () => {
    expect(llamar('usuarios.setActivo', { id: ana.id, activo: false }, tokenAna).ok).toBe(false)
  })

  it('cambiar la propia clave exige la actual y cierra las otras sesiones', () => {
    const otraSesion = login('beto@test.local', 'clave-beto-1').token
    expect(llamar('auth.cambiarPassword', { actual: 'mal', nueva: 'nueva-clave-1' }, tokenBeto).ok).toBe(false)
    ok('auth.cambiarPassword', { actual: 'clave-beto-1', nueva: 'nueva-clave-1' }, tokenBeto)
    expect(llamar('auth.yo', {}, tokenBeto).ok).toBe(true)
    expect(llamar('auth.yo', {}, otraSesion).codigo).toBe(401)
    expect(login('beto@test.local', 'nueva-clave-1').usuario.id).toBe(beto.id)
  })

  it('no permite emails repetidos ni contraseñas cortas', () => {
    expect(llamar('usuarios.crear', { nombre: 'X', email: 'BETO@test.local', password: '12345678' }, tokenAna).codigo).toBe(409)
    expect(llamar('usuarios.crear', { nombre: 'X', email: 'x@test.local', password: 'corta' }, tokenAna).ok).toBe(false)
  })
})

describe('proyectos: aislamiento por miembros', () => {
  let proyecto

  beforeEach(() => {
    proyecto = ok('proyectos.crear', { nombre: 'Web nueva', miembros: [beto.id] }, tokenAna)
  })

  it('quien lo crea queda como miembro y nacen las secciones por defecto', () => {
    expect(proyecto.miembros.sort()).toEqual([ana.id, beto.id].sort())
    const { secciones } = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    expect(secciones.map((s) => s.nombre)).toEqual(['Por hacer', 'En curso', 'Hecho'])
  })

  it('un no-miembro no lo ve en la lista ni puede cargarlo (404)', () => {
    expect(ok('proyectos.listar', {}, tokenCarla)).toHaveLength(0)
    expect(ok('proyectos.listar', {}, tokenBeto)).toHaveLength(1)
    expect(llamar('proyectos.cargar', { id: proyecto.id }, tokenCarla).codigo).toBe(404)
  })

  it('un no-miembro no puede escribir nada en el proyecto', () => {
    const { secciones } = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    const tarea = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'T1' }, tokenAna)

    const intentos = [
      ['proyectos.editar', { id: proyecto.id, nombre: 'Hackeado' }],
      ['proyectos.miembros', { id: proyecto.id, usuarios: [carla.id] }],
      ['proyectos.eliminar', { id: proyecto.id }],
      ['tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'X' }],
      ['tareas.editar', { id: tarea.id, titulo: 'Hackeada' }],
      ['tareas.eliminar', { id: tarea.id }],
      ['secciones.crear', { proyecto_id: proyecto.id, nombre: 'X' }],
      ['secciones.eliminar', { id: secciones[1].id }],
      ['etiquetas.crear', { proyecto_id: proyecto.id, nombre: 'X' }],
    ]
    for (const [accion, datos] of intentos) {
      const r = llamar(accion, datos, tokenCarla)
      expect(r.ok, accion).toBe(false)
      expect(r.codigo, accion).toBe(404)
    }
    const despues = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    expect(despues.proyecto.nombre).toBe('Web nueva')
    expect(despues.tareas).toHaveLength(1)
    expect(despues.tareas[0].titulo).toBe('T1')
    expect(despues.secciones).toHaveLength(3)
  })

  it('al sacar a alguien de miembros pierde el acceso; quien edita no puede sacarse a si mismo', () => {
    const ids = ok('proyectos.miembros', { id: proyecto.id, usuarios: [] }, tokenAna)
    expect(ids).toEqual([ana.id])
    expect(llamar('proyectos.cargar', { id: proyecto.id }, tokenBeto).codigo).toBe(404)
  })

  it('el ultimo miembro no puede salir', () => {
    ok('proyectos.miembros', { id: proyecto.id, usuarios: [] }, tokenAna)
    expect(llamar('proyectos.salir', { id: proyecto.id }, tokenAna).ok).toBe(false)
  })

  it('una seccion de OTRO proyecto no sirve para crear tareas en este', () => {
    const otro = ok('proyectos.crear', { nombre: 'Otro' }, tokenCarla)
    const { secciones: ajenas } = ok('proyectos.cargar', { id: otro.id }, tokenCarla)
    const r = llamar('tareas.crear', { proyecto_id: proyecto.id, seccion_id: ajenas[0].id, titulo: 'X' }, tokenAna)
    expect(r.ok).toBe(false)
  })

  it('el responsable tiene que ser miembro', () => {
    const { secciones } = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    const r = llamar('tareas.crear', {
      proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'X', responsable_id: carla.id,
    }, tokenAna)
    expect(r.ok).toBe(false)
  })
})

describe('tareas', () => {
  let proyecto, secciones

  beforeEach(() => {
    proyecto = ok('proyectos.crear', { nombre: 'P', miembros: [beto.id] }, tokenAna)
    secciones = ok('proyectos.cargar', { id: proyecto.id }, tokenAna).secciones
  })

  it('crea con orden incremental y guarda fechas como texto', () => {
    const a = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'A', fecha_vencimiento: '2026-10-08' }, tokenAna)
    const b = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'B' }, tokenAna)
    expect(b.orden).toBeGreaterThan(a.orden)
    expect(a.fecha_vencimiento).toBe('2026-10-08')
    expect(a.responsable_id).toBeNull()
    expect(a.completada).toBe(false)
  })

  it('mover a otra seccion arrastra las subtareas', () => {
    const t = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'Padre' }, tokenAna)
    const sub = ok('tareas.crear', { proyecto_id: proyecto.id, parent_id: t.id, titulo: 'Hija' }, tokenAna)
    expect(sub.seccion_id).toBe(secciones[0].id)
    ok('tareas.editar', { id: t.id, seccion_id: secciones[2].id, orden: 1.5 }, tokenBeto)
    const { tareas } = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    expect(tareas.find((x) => x.id === t.id)).toMatchObject({ seccion_id: secciones[2].id, orden: 1.5 })
    expect(tareas.find((x) => x.id === sub.id).seccion_id).toBe(secciones[2].id)
  })

  it('completar guarda la fecha y reabrir la borra', () => {
    const t = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'X' }, tokenAna)
    const c = ok('tareas.editar', { id: t.id, completada: true }, tokenAna)
    expect(c.completada).toBe(true)
    expect(c.completada_en).toBeTruthy()
    const r = ok('tareas.editar', { id: t.id, completada: false }, tokenAna)
    expect(r.completada_en).toBeNull()
  })

  it('eliminar una tarea borra sus subtareas', () => {
    const t = ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'Padre' }, tokenAna)
    ok('tareas.crear', { proyecto_id: proyecto.id, parent_id: t.id, titulo: 'Hija' }, tokenAna)
    ok('tareas.eliminar', { id: t.id }, tokenAna)
    expect(ok('proyectos.cargar', { id: proyecto.id }, tokenAna).tareas).toHaveLength(0)
  })

  it('etiquetas: solo se aceptan las del proyecto y al borrarla se quita de las tareas', () => {
    const e = ok('etiquetas.crear', { proyecto_id: proyecto.id, nombre: 'Urgente', color: '#f00' }, tokenAna)
    const t = ok('tareas.crear', {
      proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'X', etiquetas: [e.id, 'inventada'],
    }, tokenAna)
    expect(t.etiquetas).toEqual([e.id])
    ok('etiquetas.eliminar', { id: e.id }, tokenAna)
    expect(ok('proyectos.cargar', { id: proyecto.id }, tokenAna).tareas[0].etiquetas).toEqual([])
  })

  it('eliminar una seccion con tareas exige destino y las mueve', () => {
    ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[1].id, titulo: 'X' }, tokenAna)
    expect(llamar('secciones.eliminar', { id: secciones[1].id }, tokenAna).ok).toBe(false)
    ok('secciones.eliminar', { id: secciones[1].id, mover_a: secciones[0].id }, tokenAna)
    const d = ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    expect(d.secciones).toHaveLength(2)
    expect(d.tareas[0].seccion_id).toBe(secciones[0].id)
  })

  it('mis tareas: solo lo asignado a mi, sin completadas, solo de proyectos activos', () => {
    const base = { proyecto_id: proyecto.id, seccion_id: secciones[0].id }
    ok('tareas.crear', { ...base, titulo: 'Mia', responsable_id: beto.id }, tokenAna)
    ok('tareas.crear', { ...base, titulo: 'De Ana', responsable_id: ana.id }, tokenAna)
    const hecha = ok('tareas.crear', { ...base, titulo: 'Hecha', responsable_id: beto.id }, tokenAna)
    ok('tareas.editar', { id: hecha.id, completada: true }, tokenAna)

    const mias = ok('tareas.mias', {}, tokenBeto)
    expect(mias.map((t) => t.titulo)).toEqual(['Mia'])
    expect(mias[0].proyecto.nombre).toBe('P')
    expect(ok('tareas.mias', { incluirCompletadas: true }, tokenBeto)).toHaveLength(2)

    ok('proyectos.archivar', { id: proyecto.id, archivado: true }, tokenAna)
    expect(ok('tareas.mias', {}, tokenBeto)).toHaveLength(0)
  })

  it('resumen de la lista de proyectos cuenta vencidas segun el "hoy" del cliente', () => {
    const base = { proyecto_id: proyecto.id, seccion_id: secciones[0].id }
    ok('tareas.crear', { ...base, titulo: 'Vencida', fecha_vencimiento: '2026-01-01' }, tokenAna)
    ok('tareas.crear', { ...base, titulo: 'Futura', fecha_vencimiento: '2026-12-31' }, tokenAna)
    const [p] = ok('proyectos.listar', { hoy: '2026-06-01' }, tokenAna)
    expect(p.resumen).toEqual({ total: 2, completadas: 0, vencidas: 1 })
  })
})

describe('sheet editado a mano', () => {
  it('respeta columnas reordenadas y conserva columnas extra', () => {
    const p = ok('proyectos.crear', { nombre: 'P' }, tokenAna)
    const hoja = gas.hoja('Proyectos')
    // Intercambiar dos columnas y agregar una "notas" a mano.
    const iNombre = hoja[0].indexOf('nombre')
    const iColor = hoja[0].indexOf('color')
    for (const fila of hoja) [fila[iNombre], fila[iColor]] = [fila[iColor], fila[iNombre]]
    hoja[0].push('notas')
    hoja[1][hoja[0].length - 1] = 'dato manual'

    ok('proyectos.editar', { id: p.id, descripcion: 'nueva' }, tokenAna)
    const cargado = ok('proyectos.cargar', { id: p.id }, tokenAna).proyecto
    expect(cargado.nombre).toBe('P')
    expect(cargado.descripcion).toBe('nueva')
    expect(gas.hoja('Proyectos')[1].at(-1)).toBe('dato manual')
  })
})

describe('cache de lecturas', () => {
  let proyecto, secciones

  beforeEach(() => {
    proyecto = ok('proyectos.crear', { nombre: 'C', miembros: [beto.id] }, tokenAna)
    secciones = ok('proyectos.cargar', { id: proyecto.id }, tokenAna).secciones
  })

  it('una lectura cacheada nunca devuelve algo viejo despues de una escritura desde la app', () => {
    ok('proyectos.cargar', { id: proyecto.id }, tokenBeto) // queda en cache
    ok('tareas.crear', { proyecto_id: proyecto.id, seccion_id: secciones[0].id, titulo: 'Nueva' }, tokenAna)
    expect(ok('proyectos.cargar', { id: proyecto.id }, tokenBeto).tareas.map((t) => t.titulo)).toEqual(['Nueva'])
  })

  it('lo editado a mano en el Sheet se ve cuando vence el cache', () => {
    ok('proyectos.cargar', { id: proyecto.id }, tokenAna)
    const hoja = gas.hoja('Proyectos')
    hoja[hoja.findIndex((f) => f.includes(proyecto.id))][hoja[0].indexOf('nombre')] = 'Editado a mano'
    expect(ok('proyectos.cargar', { id: proyecto.id }, tokenAna).proyecto.nombre).toBe('C')
    gas.vaciarCache()
    // Vaciar el cache tambien cierra el atajo de la sesion: se vuelve a leer Sesiones.
    expect(ok('proyectos.cargar', { id: proyecto.id }, tokenAna).proyecto.nombre).toBe('Editado a mano')
  })

  it('una escritura usa los numeros de fila reales aunque el cache este desactualizado', () => {
    const base = { proyecto_id: proyecto.id, seccion_id: secciones[0].id }
    ok('tareas.crear', { ...base, titulo: 'Primera' }, tokenAna)
    const segunda = ok('tareas.crear', { ...base, titulo: 'Segunda' }, tokenAna)
    ok('proyectos.cargar', { id: proyecto.id }, tokenAna) // cache con 'Segunda' en la fila 3
    // Alguien borra a mano la fila de 'Primera': 'Segunda' sube a la fila 2.
    const hoja = gas.hoja('Tareas')
    hoja.splice(hoja.findIndex((f) => f.includes('Primera')), 1)
    ok('tareas.editar', { id: segunda.id, titulo: 'Segunda editada' }, tokenAna)
    const titulos = gas.hoja('Tareas').slice(1).map((f) => f[hoja[0].indexOf('titulo')])
    expect(titulos).toEqual(['Segunda editada'])
  })

  it('tablas que no entran en una entrada de cache se parten en trozos', () => {
    const base = { proyecto_id: proyecto.id, seccion_id: secciones[0].id }
    const largo = 'x'.repeat(2000)
    for (let i = 0; i < 60; i++) ok('tareas.crear', { ...base, titulo: `T${i}`, descripcion: largo }, tokenAna)
    const primera = ok('proyectos.cargar', { id: proyecto.id }, tokenAna).tareas
    const segunda = ok('proyectos.cargar', { id: proyecto.id }, tokenAna).tareas // desde el cache
    expect(primera).toHaveLength(60)
    expect(segunda).toEqual(primera)
  })

  it('cada respuesta informa cuanto tardo el servidor', () => {
    expect(llamar('auth.yo', {}, tokenAna).ms).toBeGreaterThanOrEqual(0)
  })
})

describe('sin el servicio avanzado de Sheets', () => {
  it('cae a SpreadsheetApp y funciona igual', () => {
    const g = crearGasLocal({}, { silencioso: true, email: 'x@test.local', sinSheetsApi: true })
    g.setProp('SETUP_PASSWORD', 'clave-x-123')
    g.setup()
    const { token } = g.manejar({ accion: 'auth.login', datos: { email: 'x@test.local', password: 'clave-x-123' } }).data
    const p = g.manejar({ accion: 'proyectos.crear', token, datos: { nombre: 'P' } }).data
    const { secciones } = g.manejar({ accion: 'proyectos.cargar', token, datos: { id: p.id } }).data
    g.manejar({ accion: 'tareas.crear', token, datos: { proyecto_id: p.id, seccion_id: secciones[0].id, titulo: 'T' } })
    expect(g.manejar({ accion: 'proyectos.cargar', token, datos: { id: p.id } }).data.tareas).toHaveLength(1)
  })
})
