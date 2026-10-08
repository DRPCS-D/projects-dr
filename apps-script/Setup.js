/**
 * Instalacion, se corre UNA vez a mano desde el editor de Apps Script
 * (seleccionar `setup` → Ejecutar). Es idempotente: correrlo de nuevo solo
 * agrega las hojas o columnas que falten, nunca borra datos.
 *
 *  1. Crea el Google Sheet "Proyectos DR — Base de datos" (o reusa el de DB_ID).
 *  2. Crea una hoja por tabla de ESQUEMA, con encabezados y formato de texto.
 *  3. Crea la carpeta de Drive "Proyectos DR" y mueve el Sheet adentro
 *     (ahi van a ir las carpetas de cada proyecto en la fase de Archivos).
 *  4. Si no hay ningun usuario, crea el primero con el email de quien
 *     ejecuta y una contraseña aleatoria que se muestra en el registro de
 *     ejecucion. Cambiarla al entrar (icono de llave).
 */

const NOMBRE_SISTEMA = 'Proyectos DR'

function setup() {
  const props = PropertiesService.getScriptProperties()
  let ss
  const idExistente = props.getProperty('DB_ID')
  if (idExistente) {
    ss = SpreadsheetApp.openById(idExistente)
  } else {
    ss = SpreadsheetApp.create(NOMBRE_SISTEMA + ' — Base de datos')
    props.setProperty('DB_ID', ss.getId())
  }

  prepararHojas_(ss)

  if (!props.getProperty('DRIVE_ID')) {
    const carpeta = DriveApp.createFolder(NOMBRE_SISTEMA)
    props.setProperty('DRIVE_ID', carpeta.getId())
    DriveApp.getFileById(ss.getId()).moveTo(carpeta)
  }

  resetearCacheDb()
  if (leer('Usuarios').length === 0) {
    const email = normalizarEmail(props.getProperty('SETUP_EMAIL') || Session.getEffectiveUser().getEmail())
    const password = props.getProperty('SETUP_PASSWORD') || Utilities.getUuid().slice(0, 12)
    const nombre = props.getProperty('SETUP_NOMBRE') || email.split('@')[0]
    usuariosCrear({ nombre, email, password })
    Logger.log('Primer usuario creado: ' + email + ' / contraseña: ' + password + '  (cambiala al entrar)')
  }

  Logger.log('Listo. Base: ' + ss.getUrl())
  return ss.getId()
}

function prepararHojas_(ss) {
  Object.keys(ESQUEMA).forEach((tabla) => {
    const columnas = Object.keys(ESQUEMA[tabla])
    let hoja = ss.getSheetByName(tabla)
    if (!hoja) hoja = ss.insertSheet(tabla)

    // Columnas que falten se agregan al final: nunca se reordena ni se pisa nada.
    const actuales = hoja.getLastColumn() > 0
      ? hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(String).filter(Boolean)
      : []
    const encabezados = actuales.concat(columnas.filter((c) => actuales.indexOf(c) === -1))
    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold')
    hoja.setFrozenRows(1)
    // Todo como texto, para que Sheets no convierta fechas ni numeros por su cuenta.
    hoja.getRange(1, 1, hoja.getMaxRows(), encabezados.length).setNumberFormat('@')
  })

  // La hoja vacia que trae todo Sheet nuevo ("Hoja 1" / "Sheet1") sobra.
  ss.getSheets().forEach((h) => {
    if (!ESQUEMA[h.getName()] && h.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(h)
  })
}
