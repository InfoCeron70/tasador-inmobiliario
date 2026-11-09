'use strict';

/**
 * Exportacion del resultado de una tasacion a Excel y PDF.
 *
 * Ambos endpoints reciben el JSON de la tasacion por POST (los datos del
 * inmueble, el resultado del modelo y sus metadatos), construyen el archivo en
 * memoria y lo devuelven como descarga. No se escribe nada en disco: en Render
 * el sistema de archivos es efimero.
 */

const { generarExcel } = require('../services/excel.service');
const { generarPDF } = require('../services/pdf.service');
const { construirNombreArchivo } = require('../services/informe.service');

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TIPO_PDF = 'application/pdf';

/**
 * Valida el cuerpo recibido: es obligatorio el objeto `resultado`
 * (la respuesta de POST /api/tasacion, sola o dentro de `data`).
 * @returns {{ errores: string[], entrada: object }}
 */
function validarEntradaTasacion(body) {
  const errores = [];
  const entrada = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const resultado = entrada.resultado || entrada.data;

  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) {
    errores.push('"resultado" es obligatorio y debe ser el objeto devuelto por POST /api/tasacion.');
  }

  return { errores, entrada };
}

/** Responde 400 con el formato de error comun de la API. */
function responderValidacion(res, errores) {
  return res.status(400).json({
    ok: false,
    error: {
      codigo: 'VALIDACION',
      mensaje: 'Los datos enviados no son validos para exportar.',
      detalles: errores
    }
  });
}

/** Responde 500 con el formato de error comun de la API. */
function responderErrorExportacion(res, mensaje) {
  return res.status(500).json({
    ok: false,
    error: {
      codigo: 'EXPORT_ERROR',
      mensaje
    }
  });
}

/**
 * Envia el archivo generado como descarga directa (adjunto).
 * @param {import('express').Response} res
 * @param {Buffer} buffer Contenido del archivo.
 * @param {{ nombre: string, tipo: string }} opciones Nombre y Content-Type.
 */
function enviarArchivo(res, buffer, opciones) {
  res.setHeader('Content-Type', opciones.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${opciones.nombre}"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return res.status(200).send(buffer);
}

/**
 * POST /api/exportar/excel
 * Genera un libro .xlsx con los valores principales, los comparables
 * analizados y los factores de ajuste.
 */
async function exportarExcel(req, res) {
  const { errores, entrada } = validarEntradaTasacion(req.body);

  if (errores.length > 0) {
    return responderValidacion(res, errores);
  }

  try {
    const buffer = await generarExcel(entrada);

    return enviarArchivo(res, buffer, {
      nombre: construirNombreArchivo('xlsx', entrada.datos || entrada.propiedad),
      tipo: TIPO_XLSX
    });
  } catch (error) {
    console.error('[export.controller] Error al generar el Excel:', error);
    return responderErrorExportacion(res, 'No fue posible generar el archivo Excel de la tasacion.');
  }
}

/**
 * POST /api/exportar/pdf
 * Genera un documento PDF con el informe de la tasacion.
 */
async function exportarPDF(req, res) {
  const { errores, entrada } = validarEntradaTasacion(req.body);

  if (errores.length > 0) {
    return responderValidacion(res, errores);
  }

  try {
    const buffer = await generarPDF(entrada);

    return enviarArchivo(res, buffer, {
      nombre: construirNombreArchivo('pdf', entrada.datos || entrada.propiedad),
      tipo: TIPO_PDF
    });
  } catch (error) {
    console.error('[export.controller] Error al generar el PDF:', error);
    return responderErrorExportacion(res, 'No fue posible generar el archivo PDF de la tasacion.');
  }
}

module.exports = {
  exportarExcel,
  exportarPDF,
  validarEntradaTasacion
};
