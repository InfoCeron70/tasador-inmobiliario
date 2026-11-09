'use strict';

/**
 * Exportacion del informe de tasacion a PDF con pdfkit.
 *
 * El documento se genera completamente en memoria (el PDF se acumula en un
 * Buffer a partir del evento 'data') y se devuelve como Buffer. No se escribe
 * ningun archivo en disco: en Render el sistema de archivos es efimero.
 *
 * Nota sobre fuentes: se usan las fuentes estandar de PDFKit (Helvetica), que
 * cubren los caracteres del espanol (acentos, ñ, m², comillas y guiones).
 */

const PDFDocument = require('pdfkit');
const {
  construirInforme,
  formatearCLP,
  formatearNumero,
  formatearFactor
} = require('./informe.service');

// ---------- Maquetacion ----------
const MARGEN = 45;
const PADDING_CELDA = 5;
const ALTO_MINIMO_FILA = 16;
// Espacio reservado al pie para que el contenido nunca lo invada
const ESPACIO_PIE = 46;

// ---------- Paleta (misma que la interfaz web) ----------
const COLOR_INDIGO = '#4F46E5';
const COLOR_INDIGO_CLARO = '#E0E7FF';
const COLOR_INDIGO_TEXTO = '#C7D2FE';
const COLOR_SLATE_900 = '#0F172A';
const COLOR_SLATE_700 = '#334155';
const COLOR_SLATE_500 = '#64748B';
const COLOR_SLATE_200 = '#E2E8F0';
const COLOR_SLATE_50 = '#F8FAFC';
const COLOR_BLANCO = '#FFFFFF';
const COLOR_AMARILLO_FONDO = '#FEF9C3';
const COLOR_AMARILLO_TEXTO = '#713F12';

const FUENTE = 'Helvetica';
const FUENTE_NEGRITA = 'Helvetica-Bold';

/** Ancho util de la pagina (entre margenes). */
function anchoContenido(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Y maxima que puede alcanzar el contenido antes del pie de pagina. */
function limiteInferior(doc) {
  return doc.page.height - doc.page.margins.bottom - ESPACIO_PIE;
}

/** Reinicia el cursor horizontal al margen izquierdo. */
function irAlInicioDeLinea(doc) {
  doc.x = doc.page.margins.left;
}

/** Baja el cursor e reinicia el horizontal. */
function avanzar(doc, puntos) {
  doc.y += puntos;
  irAlInicioDeLinea(doc);
}

/** Agrega una pagina si el contenido indicado no cabe en la actual. */
function asegurarEspacio(doc, alto) {
  if (doc.y + alto > limiteInferior(doc)) {
    doc.addPage();
    irAlInicioDeLinea(doc);
  }
}

/** Banda superior con el titulo del informe. */
function dibujarEncabezado(doc, informe) {
  const anchoPagina = doc.page.width;
  const ancho = anchoContenido(doc);

  doc.save();
  doc.rect(0, 0, anchoPagina, 96).fill(COLOR_INDIGO);
  doc.restore();

  doc.fillColor(COLOR_BLANCO).font(FUENTE_NEGRITA).fontSize(18)
    .text('TASACIÓN INMOBILIARIA REFERENCIAL', MARGEN, 26, { width: ancho });

  doc.fillColor(COLOR_INDIGO_TEXTO).font(FUENTE).fontSize(9)
    .text('Informe referencial generado con IA · Chile', MARGEN, 53, { width: ancho });

  doc.fillColor(COLOR_INDIGO_TEXTO).font(FUENTE).fontSize(8.5)
    .text(
      `Emitido: ${informe.generadoEnTexto}   ·   Modelo: ${informe.meta.modelo}`,
      MARGEN,
      69,
      { width: ancho }
    );

  doc.y = 116;
  irAlInicioDeLinea(doc);
}

/** Titulo de seccion con linea inferior. */
function dibujarTituloSeccion(doc, titulo) {
  asegurarEspacio(doc, 36);

  const x = doc.page.margins.left;
  const ancho = anchoContenido(doc);

  doc.fillColor(COLOR_SLATE_900).font(FUENTE_NEGRITA).fontSize(11)
    .text(titulo, x, doc.y, { width: ancho });

  const y = doc.y + 3;
  doc.save();
  doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(1).strokeColor(COLOR_INDIGO_CLARO).stroke();
  doc.restore();

  doc.y = y + 10;
  irAlInicioDeLinea(doc);
}


/** Caja destacada con el valor de referencia y el rango estimado. */
function dibujarDestacado(doc, informe) {
  const alto = 92;
  asegurarEspacio(doc, alto + 14);

  const x = doc.page.margins.left;
  const ancho = anchoContenido(doc);
  const y = doc.y;

  doc.save();
  doc.roundedRect(x, y, ancho, alto, 10).fill(COLOR_INDIGO);
  doc.restore();

  doc.fillColor(COLOR_INDIGO_TEXTO).font(FUENTE_NEGRITA).fontSize(8)
    .text('VALOR DE REFERENCIA', x + 18, y + 14, { width: ancho - 36 });

  doc.fillColor(COLOR_BLANCO).font(FUENTE_NEGRITA).fontSize(22)
    .text(informe.valorReferenciaTexto, x + 18, y + 26, { width: ancho - 36 });

  doc.fillColor(COLOR_INDIGO_TEXTO).font(FUENTE_NEGRITA).fontSize(8)
    .text('RANGO ESTIMADO', x + 18, y + 60, { width: ancho - 36 });

  doc.fillColor(COLOR_BLANCO).font(FUENTE).fontSize(11)
    .text(informe.rangoTexto, x + 18, y + 72, { width: ancho - 36 });

  doc.y = y + alto + 16;
  irAlInicioDeLinea(doc);
}

/**
 * Filas etiqueta / valor (dos columnas).
 * @param {Array<[string, string]>} filas
 */
function dibujarFilasDato(doc, filas) {
  const anchoEtiqueta = 132;
  const separacion = 10;

  filas.forEach(([etiqueta, valor]) => {
    const x = doc.page.margins.left;
    const ancho = anchoContenido(doc);
    const anchoValor = ancho - anchoEtiqueta - separacion;
    const valorTexto = String(valor === null || valor === undefined ? '—' : valor);

    doc.font(FUENTE_NEGRITA).fontSize(9);
    const altoEtiqueta = doc.heightOfString(etiqueta, { width: anchoEtiqueta });
    doc.font(FUENTE).fontSize(9.5);
    const altoValor = doc.heightOfString(valorTexto, { width: anchoValor });
    const alto = Math.max(altoEtiqueta, altoValor, 11);

    asegurarEspacio(doc, alto + 8);

    const y = doc.y;

    doc.fillColor(COLOR_SLATE_500).font(FUENTE_NEGRITA).fontSize(9)
      .text(etiqueta, x, y, { width: anchoEtiqueta });

    doc.fillColor(COLOR_SLATE_900).font(FUENTE).fontSize(9.5)
      .text(valorTexto, x + anchoEtiqueta + separacion, y, { width: anchoValor });

    doc.y = y + alto + 7;
    irAlInicioDeLinea(doc);
  });
}

/** Parrafo de texto corrido (con ajuste de linea). */
function dibujarParrafo(doc, texto, opciones = {}) {
  const x = doc.page.margins.left;
  const ancho = anchoContenido(doc);
  const tamano = opciones.tamano || 9.5;
  const alineacion = opciones.alineacion || 'left';

  doc.font(opciones.negrita ? FUENTE_NEGRITA : FUENTE).fontSize(tamano);
  const alto = doc.heightOfString(texto, { width: ancho, align: alineacion });

  asegurarEspacio(doc, alto + 8);

  doc.fillColor(opciones.color || COLOR_SLATE_700)
    .text(texto, x, doc.y, { width: ancho, align: alineacion, lineGap: 1.5 });

  avanzar(doc, opciones.separacion === undefined ? 8 : opciones.separacion);
}

/** Lista de advertencias: una tarjeta amarilla por advertencia. */
function dibujarAdvertencias(doc, advertencias) {
  advertencias.forEach((advertencia) => {
    const texto = `•  ${advertencia}`;
    const x = doc.page.margins.left;
    const ancho = anchoContenido(doc);

    doc.font(FUENTE).fontSize(9);
    const alto = doc.heightOfString(texto, { width: ancho - 24 }) + 14;

    asegurarEspacio(doc, alto + 6);

    const y = doc.y;

    doc.save();
    doc.roundedRect(x, y, ancho, alto, 6).fill(COLOR_AMARILLO_FONDO);
    doc.restore();

    doc.fillColor(COLOR_AMARILLO_TEXTO).font(FUENTE).fontSize(9)
      .text(texto, x + 12, y + 7, { width: ancho - 24 });

    doc.y = y + alto + 5;
    irAlInicioDeLinea(doc);
  });
}

/**
 * Tabla con encabezado; repite el encabezado cuando cambia de pagina.
 * @param {object[]} columnas [{ titulo, ancho, alineacion }]
 * @param {Array<Array<string|number|null>>} filas Celdas ya formateadas.
 */
function dibujarTabla(doc, columnas, filas) {
  const anchoTotal = columnas.reduce((suma, columna) => suma + columna.ancho, 0);
  const ALTO_ENCABEZADO_TABLA = 22;

  const dibujarEncabezadoTabla = () => {
    const alto = ALTO_ENCABEZADO_TABLA;
    asegurarEspacio(doc, alto + 4);

    const x = doc.page.margins.left;
    const y = doc.y;

    doc.save();
    doc.rect(x, y, anchoTotal, alto).fill(COLOR_INDIGO_CLARO);
    doc.restore();

    let cursor = x;
    doc.font(FUENTE_NEGRITA).fontSize(8).fillColor(COLOR_SLATE_700);
    columnas.forEach((columna) => {
      doc.text(columna.titulo, cursor + PADDING_CELDA, y + 7, {
        width: columna.ancho - PADDING_CELDA * 2,
        align: columna.alineacion || 'left',
        lineBreak: false
      });
      cursor += columna.ancho;
    });

    doc.y = y + alto;
    irAlInicioDeLinea(doc);
  };

  const valorCelda = (celda) => (celda === null || celda === undefined ? '—' : String(celda));

  // Alto de cada fila (la celda mas alta manda)
  const altosFilas = filas.map((celdas) => {
    doc.font(FUENTE).fontSize(8);

    return columnas.reduce((maximo, columna, indice) => {
      const necesario = doc.heightOfString(valorCelda(celdas[indice]), {
        width: columna.ancho - PADDING_CELDA * 2
      }) + PADDING_CELDA * 2;

      return Math.max(maximo, necesario);
    }, ALTO_MINIMO_FILA);
  });

  // El encabezado y la primera fila viajan juntos (evita encabezados huerfanos)
  const altoPrimeraFila = altosFilas.length > 0 ? altosFilas[0] : 0;
  if (doc.y + ALTO_ENCABEZADO_TABLA + altoPrimeraFila > limiteInferior(doc)) {
    doc.addPage();
  }

  dibujarEncabezadoTabla();

  filas.forEach((celdas, indiceFila) => {
    const alto = altosFilas[indiceFila];

    if (doc.y + alto > limiteInferior(doc)) {
      doc.addPage();
      dibujarEncabezadoTabla();
    }

    const x = doc.page.margins.left;
    const y = doc.y;

    if (indiceFila % 2 === 1) {
      doc.save();
      doc.rect(x, y, anchoTotal, alto).fill(COLOR_SLATE_50);
      doc.restore();
    }

    doc.save();
    doc.moveTo(x, y + alto).lineTo(x + anchoTotal, y + alto)
      .lineWidth(0.5).strokeColor(COLOR_SLATE_200).stroke();
    doc.restore();

    let cursor = x;
    columnas.forEach((columna, indice) => {
      doc.fillColor(COLOR_SLATE_700).font(FUENTE).fontSize(8)
        .text(valorCelda(celdas[indice]), cursor + PADDING_CELDA, y + PADDING_CELDA, {
          width: columna.ancho - PADDING_CELDA * 2,
          align: columna.alineacion || 'left'
        });
      cursor += columna.ancho;
    });

    doc.y = y + alto;
    irAlInicioDeLinea(doc);
  });

  avanzar(doc, 10);
}

// ---------- Definicion de columnas de las tablas (suman el ancho util) ----------
const COLUMNAS_COMPARABLES = [
  { titulo: 'Referencia', ancho: 92 },
  { titulo: 'Comuna', ancho: 66 },
  { titulo: 'Superf. m²', ancho: 50, alineacion: 'right' },
  { titulo: 'Valor m²', ancho: 70, alineacion: 'right' },
  { titulo: 'Factor', ancho: 40, alineacion: 'center' },
  { titulo: 'Justificación', ancho: 187 }
];

const COLUMNAS_FACTORES = [
  { titulo: 'Factor', ancho: 130 },
  { titulo: 'Valor', ancho: 50, alineacion: 'center' },
  { titulo: 'Justificación', ancho: 325 }
];

/** Dibuja todo el contenido del informe sobre el documento. */
function dibujarInforme(doc, informe) {
  dibujarEncabezado(doc, informe);

  // ---------- Valor destacado ----------
  dibujarDestacado(doc, informe);

  // ---------- Datos del inmueble ----------
  dibujarTituloSeccion(doc, 'Datos del inmueble');
  dibujarFilasDato(doc, informe.datosInmueble);
  avanzar(doc, 6);

  // ---------- Resultado ----------
  dibujarTituloSeccion(doc, 'Resultado de la tasación');
  dibujarFilasDato(doc, [
    ['Valor por m²', `${informe.valorM2Texto} /m²`],
    ['Rango estimado', informe.rangoTexto]
  ]);

  if (informe.valorM2Justificacion) {
    dibujarFilasDato(doc, [['Justificación del valor m²', informe.valorM2Justificacion]]);
  }

  if (informe.meta.reconstruido) {
    dibujarParrafo(
      doc,
      'Nota: el modelo truncó la respuesta y el JSON se reconstruyó parcialmente. ' +
        'Revise las advertencias antes de utilizar estos valores.',
      { tamano: 8.5, color: COLOR_AMARILLO_TEXTO }
    );
  }

  avanzar(doc, 6);

  // ---------- Conclusion ----------
  dibujarTituloSeccion(doc, 'Conclusión del tasador');
  dibujarParrafo(doc, informe.resumen, { separacion: 14 });

  // ---------- Comparables ----------
  dibujarTituloSeccion(doc, `Comparables analizados (${informe.comparables.length})`);

  if (informe.comparables.length === 0) {
    dibujarParrafo(doc, 'Sin comparables informados por el modelo.', { color: COLOR_SLATE_500 });
  } else {
    dibujarTabla(
      doc,
      COLUMNAS_COMPARABLES,
      informe.comparables.map((comparable) => [
        comparable.referencia,
        comparable.comuna,
        formatearNumero(comparable.superficieM2),
        formatearCLP(comparable.valorM2),
        formatearFactor(comparable.factorAjuste),
        comparable.justificacion
      ])
    );
  }

  avanzar(doc, 4);

  // ---------- Factores de ajuste ----------
  dibujarTituloSeccion(doc, 'Factores de ajuste aplicados');

  if (informe.factores.length === 0) {
    dibujarParrafo(doc, 'El modelo no detalló factores de ajuste.', { color: COLOR_SLATE_500 });
  } else {
    dibujarTabla(
      doc,
      COLUMNAS_FACTORES,
      informe.factores.map((factor) => [
        factor.factor,
        formatearFactor(factor.valor),
        factor.justificacion
      ])
    );
  }

  avanzar(doc, 4);

  // ---------- Advertencias ----------
  dibujarTituloSeccion(doc, 'Advertencias');

  if (informe.advertencias.length === 0) {
    dibujarParrafo(doc, 'El modelo no declaró advertencias.', { color: COLOR_SLATE_500 });
  } else {
    dibujarAdvertencias(doc, informe.advertencias);
  }

  avanzar(doc, 12);

  // ---------- Pie del contenido ----------
  dibujarParrafo(
    doc,
    'Estimación referencial generada con IA. No reemplaza una tasación oficial ' +
      'firmada por un tasador acreditado.',
    { tamano: 8, color: COLOR_SLATE_500, alineacion: 'center' }
  );
}

/**
 * Numera las paginas y agrega la leyenda inferior.
 * Requiere que el documento se haya creado con bufferPages: true.
 */
function dibujarPiesDePagina(doc) {
  const rango = doc.bufferedPageRange();
  const total = rango.count;

  for (let indice = rango.start; indice < rango.start + total; indice += 1) {
    doc.switchToPage(indice);

    const margenInferiorOriginal = doc.page.margins.bottom;
    // Sin margen inferior el pie nunca provoca un salto de pagina
    doc.page.margins.bottom = 0;

    const x = doc.page.margins.left;
    const ancho = anchoContenido(doc);
    const altoPagina = doc.page.height;

    doc.save();
    doc.moveTo(x, altoPagina - 54).lineTo(x + ancho, altoPagina - 54)
      .lineWidth(0.5).strokeColor(COLOR_SLATE_200).stroke();
    doc.restore();

    doc.fillColor(COLOR_SLATE_500).font(FUENTE).fontSize(7.5)
      .text(
        'Tasador IA · Estimación referencial generada con IA. No reemplaza una tasación oficial.',
        x,
        altoPagina - 46,
        { width: ancho, align: 'center', lineBreak: false }
      );

    doc.fillColor(COLOR_SLATE_500).font(FUENTE).fontSize(7.5)
      .text(`Página ${indice + 1} de ${total}`, x, altoPagina - 34, {
        width: ancho,
        align: 'center',
        lineBreak: false
      });

    doc.page.margins.bottom = margenInferiorOriginal;
  }
}

/**
 * Genera el informe de tasacion como PDF en memoria.
 * @param {object} entrada Cuerpo recibido por POST /api/exportar/pdf.
 * @returns {Promise<Buffer>} Contenido del archivo .pdf.
 */
function generarPDF(entrada) {
  const informe = construirInforme(entrada);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGEN,
      bufferPages: true,
      info: {
        Title: 'Tasación inmobiliaria referencial',
        Author: 'Tasador IA',
        Subject: `Tasación referencial · ${informe.datos.comuna || 'Chile'}`,
        Creator: 'Tasador IA',
        CreationDate: informe.generadoEn
      }
    });

    const partes = [];

    doc.on('data', (parte) => partes.push(parte));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    try {
      dibujarInforme(doc, informe);
      dibujarPiesDePagina(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generarPDF };
