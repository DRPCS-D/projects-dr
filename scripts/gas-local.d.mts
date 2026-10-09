export interface GasLocal {
  manejar: (req: unknown) => unknown
  setup: () => unknown
  setProp: (clave: string, valor: string) => void
  hoja: (nombre: string) => string[][] | null
  vaciarCache: () => void
  exportar: () => { hojas: Record<string, string[][]>; props: Record<string, string> }
}
export function crearGasLocal(
  estado?: { hojas?: Record<string, string[][]>; props?: Record<string, string> },
  opciones?: { email?: string; fallarLock?: boolean; silencioso?: boolean; sinSheetsApi?: boolean },
): GasLocal
