'use strict';

/**
 * Exportacion del informe de tasacion a Excel (.xlsx) con exceljs.
 *
 * El archivo se construye en memoria (writeBuffer) y se devuelve como Buffer:
 * nunca se escribe nada en el disco del servidor, porque en Render el sistema
 * de archivos es efimero.
 */

const ExcelJS = require('exceljs');
const { construirInforme } = require('./informe.service');

// ---------- Paleta y constantes de maquetacion ----------
const TOTAL_COLUMNAS = 7;
const ANCHOS_COLUMNAS = [26, 22, 18, 18, 12, 20, 44];

const COLOR_INDIGO = 'FF4F46E5';
const COLOR_INDIGO_CLARO = 'FFE0E7FF';
const COLOR_SLATE_900 = 'FF0F172A';
const COLOR_SLATE_700 = 'FF334155';
const COLOR_SLATE_500 = 'FF64748B';
const COLOR_BLANCO = 'FFFFFFFF';
const COLOR_BORDE = 'FFE2E8F0';
const COLOR_FILA_ALTERNA = 'FFF8FAFC';
const COLOR_ADVERTENCIA = 'FFFEF3C7';

const FORMATO_MONEDA = '"$"#,##0';
const FORMATO_DECIMAL = '#,##0.0';
const FORMATO_FACTOR = '0.00';

const BORDE_INFERIOR = { bottom: { style: 'thin', color: { argb: COLOR_BORDE } } };

/**
 * Escribe un texto en toda la fila (celdas fusionadas A:G).
 * @returns {number} Siguiente fila libre.
 */
function escribirFilaCompleta(hoja, fila, texto, estilo = {}) {
  hoja.mergeCells(fila, 1, fila, TOTAL_COLUMNAS);

  const celda = hoja.getCell(fila, 1);
  celda.value = texto;
  celda.font = estilo.font || { name: 'Calibri', size: 11, color: { argb: COLOR_SLATE_700 } };
  celda.alignment = estilo.alignment || { vertical: 'middle', horizontal: 'left', wrapText: true };
  celda.border = estilo.border || bordeCompleto();

  if (estilo.fill) {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: estilo.fill } };
  }

  hoja.getRow(fila).height = estilo.height || 18;

  return fila + 1;
}

/** Borde fino en las cuatro caras (para que las tablas se vean definidas). */
function bordeCompleto(color = COLOR_BORDE) {
  return {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } }
  };
}

/** Titulo principal del informe. */
function escribirTitulo(hoja, fila, texto) {
  return escribirFilaCompleta(hoja, fila, texto, {
    font: { name: 'Calibri', size: 16, bold: true, color: { argb: COLOR_BLANCO } },
    fill: COLOR_INDIGO,
    height: 30
  });
}

/** Encabezado de seccion (banda indigo claro). */
function escribirSeccion(hoja, fila, texto) {
  return escribirFilaCompleta(hoja, fila, texto, {
    font: { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_SLATE_900 } },
    fill: COLOR_INDIGO_CLARO,
    height: 20
  });
}

/**
 * Fila etiqueta / valor: la etiqueta ocupa la columna A y el valor B:G.
 * @returns {number} Siguiente fila libre.
 */
function escribirDato(hoja, fila, etiqueta, valor, opciones = {}) {
  const celdaEtiqueta = hoja.getCell(fila, 1);
  celdaEtiqueta.value = etiqueta;
  celdaEtiqueta.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR_SLATE_500 } };
  celdaEtiqueta.alignment = { vertical: 'middle', horizontal: 'left' };
  celdaEtiqueta.border = BORDE_INFERIOR;

  hoja.mergeCells(fila, 2, fila, TOTAL_COLUMNAS);

  const celdaValor = hoja.getCell(fila, 2);
  celdaValor.value = valor;
  celdaValor.font = opciones.font || { name: 'Calibri', size: 10, color: { argb: COLOR_SLATE_700 } };
  celdaValor.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  celdaValor.border = BORDE_INFERIOR;

  if (opciones.numFmt) celdaValor.numFmt = opciones.numFmt;
  if (opciones.height) hoja.getRow(fila).height = opciones.height;

  if (opciones.fill) {
    const relleno = { type: 'pattern', pattern: 'solid', fgColor: { argb: opciones.fill } };
    celdaEtiqueta.fill = relleno;
    celdaValor.fill = relleno;
  }

  return fila + 1;
}

/**
 * Tabla con encabezado y filas de datos.
 * @param {object[]} columnas [{ titulo, ancho? , alineacion?, numFmt? }]
 * @param {Array<Array<string|number|null>>} filas
 * @returns {number} Siguiente fila libre.
 */
function escribirTabla(hoja, fila, columnas, filas) {
  // ---------- Encabezado ----------
  columnas.forEach((columna, indice) => {
    if (columna.fusionarHasta) {
      hoja.mergeCells(fila, indice + 1, fila, columna.fusionarHasta);
    }

    const celda = hoja.getCell(fila, indice + 1);
    celda.value = columna.titulo;
    celda.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLOR_SLATE_700 } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_INDIGO_CLARO } };
    celda.alignment = {
      vertical: 'middle',
      horizontal: columna.alineacion || 'left',
      wrapText: true
    };
    celda.border = bordeCompleto();
  });

  hoja.getRow(fila).height = 22;
  let siguienteFila = fila + 1;

  // ---------- Filas de datos ----------
  filas.forEach((valores, indiceFila) => {
    columnas.forEach((columna, indiceColumna) => {
      if (columna.fusionarHasta) {
        hoja.mergeCells(siguienteFila, indiceColumna + 1, siguienteFila, columna.fusionarHasta);
      }

      const celda = hoja.getCell(siguienteFila, indiceColumna + 1);
      const valor = valores[indiceColumna];

      celda.value = valor === null || valor === undefined ? '—' : valor;
      celda.font = { name: 'Calibri', size: 10, color: { argb: COLOR_SLATE_700 } };
      celda.alignment = {
        vertical: 'top',
        horizontal: columna.alineacion || 'left',
        wrapText: true
      };
      celda.border = bordeCompleto();

      if (columna.numFmt && typeof celda.value === 'number') {
        celda.numFmt = columna.numFmt;
      }

      if (indiceFila % 2 === 1) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_FILA_ALTERNA } };
      }
    });

    // Sin altura fija: Excel ajusta automaticamente el alto del texto envuelto
    siguienteFila += 1;
  });

  return siguienteFila;
}


/**
 * Genera el informe de tasacion como archivo Excel en memoria.
 * @param {object} entrada Cuerpo recibido por POST /api/exportar/excel.
 * @returns {Promise<Buffer>} Contenido del archivo .xlsx.
 */
async function generarExcel(entrada) {
  const informe = construirInforme(entrada);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'Tasador IA';
  libro.lastModifiedBy = 'Tasador IA';
  libro.created = informe.generadoEn;
  libro.modified = informe.generadoEn;
  libro.title = 'Tasación inmobiliaria referencial';
  libro.subject = `Tasación referencial · ${informe.datos.comuna || 'Chile'}`;
  libro.description = 'Informe referencial generado con IA. No reemplaza una tasación oficial.';

  const hoja = libro.addWorksheet('Tasación', {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
    }
  });

  hoja.columns = ANCHOS_COLUMNAS.map((ancho) => ({ width: ancho }));

  // ---------- Encabezado ----------
  let fila = 1;
  fila = escribirTitulo(hoja, fila, 'TASACIÓN INMOBILIARIA REFERENCIAL');
  fila = escribirFilaCompleta(hoja, fila, 'Informe referencial generado con IA · Chile', {
    font: { name: 'Calibri', size: 10, italic: true, color: { argb: COLOR_SLATE_500 } }
  });
  fila = escribirFilaCompleta(
    hoja,
    fila,
    `Emitido: ${informe.generadoEnTexto}   ·   Modelo: ${informe.meta.modelo}`,
    { font: { name: 'Calibri', size: 10, color: { argb: COLOR_SLATE_500 } } }
  );
  fila += 1;

  // ---------- Datos del inmueble ----------
  fila = escribirSeccion(hoja, fila, 'DATOS DEL INMUEBLE');
  informe.datosInmueble.forEach(([etiqueta, valor]) => {
    fila = escribirDato(hoja, fila, etiqueta, valor);
  });
  fila += 1;

  // ---------- Resultado ----------
  fila = escribirSeccion(hoja, fila, 'RESULTADO DE LA TASACIÓN');

  fila = escribirDato(hoja, fila, 'Valor de referencia', informe.valorReferenciaTexto, {
    font: { name: 'Calibri', size: 14, bold: true, color: { argb: COLOR_INDIGO } },
    fill: COLOR_INDIGO_CLARO,
    height: 26
  });

  fila = escribirDato(hoja, fila, 'Rango estimado', informe.rangoTexto, {
    font: { name: 'Calibri', size: 11, bold: true, color: { argb: COLOR_SLATE_900 } }
  });

  fila = escribirDato(hoja, fila, 'Valor por m²', `${informe.valorM2Texto} /m²`);

  if (informe.valorM2Justificacion) {
    fila = escribirDato(hoja, fila, 'Justificación del valor m²', informe.valorM2Justificacion);
  }

  fila = escribirDato(hoja, fila, 'Conclusión del tasador', informe.resumen);

  if (informe.meta.reconstruido) {
    fila = escribirDato(
      hoja,
      fila,
      'Nota',
      'El modelo truncó la respuesta y el JSON se reconstruyó parcialmente: revise las advertencias.'
    );
  }

  fila += 1;

  // ---------- Comparables ----------
  fila = escribirSeccion(hoja, fila, `COMPARABLES ANALIZADOS (${informe.comparables.length})`);

  if (informe.comparables.length === 0) {
    fila = escribirFilaCompleta(hoja, fila, 'Sin comparables informados por el modelo.');
  } else {
    fila = escribirTabla(
      hoja,
      fila,
      [
        { titulo: 'Referencia' },
        { titulo: 'Comuna' },
        { titulo: 'Superficie (m²)', alineacion: 'right', numFmt: FORMATO_DECIMAL },
        { titulo: 'Valor m²', alineacion: 'right', numFmt: FORMATO_MONEDA },
        { titulo: 'Factor', alineacion: 'center', numFmt: FORMATO_FACTOR },
        { titulo: 'Valor m² ajustado', alineacion: 'right', numFmt: FORMATO_MONEDA },
        { titulo: 'Justificación' }
      ],
      informe.comparables.map((comparable) => [
        comparable.referencia,
        comparable.comuna,
        comparable.superficieM2,
        comparable.valorM2,
        comparable.factorAjuste,
        comparable.valorM2Ajustado,
        comparable.justificacion
      ])
    );
  }

  fila += 1;

  // ---------- Factores de ajuste ----------
  fila = escribirSeccion(hoja, fila, 'FACTORES DE AJUSTE APLICADOS');

  if (informe.factores.length === 0) {
    fila = escribirFilaCompleta(hoja, fila, 'El modelo no detalló factores de ajuste.');
  } else {
    fila = escribirTabla(
      hoja,
      fila,
      [
        { titulo: 'Factor' },
        { titulo: 'Valor', alineacion: 'center', numFmt: FORMATO_FACTOR },
        { titulo: 'Justificación', fusionarHasta: TOTAL_COLUMNAS }
      ],
      informe.factores.map((factor) => [factor.factor, factor.valor, factor.justificacion])
    );
  }

  fila += 1;

  // ---------- Advertencias ----------
  fila = escribirSeccion(hoja, fila, 'ADVERTENCIAS');

  if (informe.advertencias.length === 0) {
    fila = escribirFilaCompleta(hoja, fila, 'El modelo no declaró advertencias.');
  } else {
    informe.advertencias.forEach((advertencia) => {
      fila = escribirFilaCompleta(hoja, fila, `•  ${advertencia}`, { fill: COLOR_ADVERTENCIA });
    });
  }

  fila += 1;

  // ---------- Pie ----------
  fila = escribirFilaCompleta(
    hoja,
    fila,
    'Estimación referencial generada con IA. No reemplaza una tasación oficial firmada por un tasador acreditado.',
    {
      font: { name: 'Calibri', size: 9, italic: true, color: { argb: COLOR_SLATE_500 } },
      border: {}
    }
  );

  const buffer = await libro.xlsx.writeBuffer();

  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

module.exports = { generarExcel };
