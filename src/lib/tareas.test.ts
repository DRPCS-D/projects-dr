import { describe, expect, it } from 'vitest'
import { agruparMisTareas, estadoVencimiento, fechaCorta, iniciales, ordenEntre, sumarDias } from './tareas'
import type { Tarea } from './tipos'

const HOY = '2026-10-08'

function tarea(p: Partial<Tarea>): Tarea {
  return {
    id: 'x',
    proyecto_id: 'p',
    seccion_id: 's',
    parent_id: null,
    titulo: 't',
    descripcion: '',
    responsable_id: null,
    fecha_inicio: null,
    fecha_vencimiento: null,
    prioridad: null,
    etiquetas: [],
    completada: false,
    completada_en: null,
    orden: 1,
    creado_por: 'u',
    creado_en: '',
    actualizado_en: '',
    ...p,
  }
}

describe('ordenEntre', () => {
  it('promedia entre dos, y suma/resta 1 en los extremos', () => {
    expect(ordenEntre(1, 2)).toBe(1.5)
    expect(ordenEntre(undefined, 3)).toBe(2)
    expect(ordenEntre(3, undefined)).toBe(4)
    expect(ordenEntre(undefined, undefined)).toBe(1)
  })
})

describe('fechas', () => {
  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-12-30', 3)).toBe('2027-01-02')
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('estadoVencimiento', () => {
    expect(estadoVencimiento(tarea({ fecha_vencimiento: '2026-10-07' }), HOY)).toBe('vencida')
    expect(estadoVencimiento(tarea({ fecha_vencimiento: HOY }), HOY)).toBe('hoy')
    expect(estadoVencimiento(tarea({ fecha_vencimiento: '2026-10-11' }), HOY)).toBe('pronto')
    expect(estadoVencimiento(tarea({ fecha_vencimiento: '2026-10-20' }), HOY)).toBe('normal')
    expect(estadoVencimiento(tarea({ fecha_vencimiento: '2026-10-01', completada: true }), HOY)).toBeNull()
  })

  it('fechaCorta', () => {
    expect(fechaCorta(HOY, HOY)).toBe('Hoy')
    expect(fechaCorta('2026-10-09', HOY)).toBe('Mañana')
    expect(fechaCorta('2026-11-03', HOY)).toBe('3 nov')
    expect(fechaCorta('2027-01-03', HOY)).toBe('3 ene 2027')
  })
})

describe('agruparMisTareas', () => {
  it('reparte por vencimiento y ordena por fecha', () => {
    const g = agruparMisTareas(
      [
        tarea({ id: 'a', fecha_vencimiento: '2026-10-01' }),
        tarea({ id: 'b', fecha_vencimiento: HOY }),
        tarea({ id: 'c', fecha_vencimiento: '2026-10-12' }),
        tarea({ id: 'd', fecha_vencimiento: '2026-10-10' }),
        tarea({ id: 'e', fecha_vencimiento: '2026-12-01' }),
        tarea({ id: 'f' }),
        tarea({ id: 'g', completada: true, fecha_vencimiento: '2026-10-01' }),
      ],
      HOY,
    )
    expect(g.vencidas.map((t) => t.id)).toEqual(['a'])
    expect(g.hoy.map((t) => t.id)).toEqual(['b'])
    expect(g.semana.map((t) => t.id)).toEqual(['d', 'c'])
    expect(g.despues.map((t) => t.id)).toEqual(['e'])
    expect(g.sin_fecha.map((t) => t.id)).toEqual(['f'])
    expect(g.completadas.map((t) => t.id)).toEqual(['g'])
  })
})

describe('iniciales', () => {
  it('usa primer y ultimo nombre', () => {
    expect(iniciales('Ana María Pérez')).toBe('AP')
    expect(iniciales('beto')).toBe('BE')
  })
})
