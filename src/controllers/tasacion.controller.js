'use strict';

const { calcularTasacion } = require('../services/deepseek.service');
const { guardarTasacion, listarTasaciones } = require('../database');

const TIPOS_PROPIEDAD = ['casa', 'departamento', 'oficina', 'terreno', 'local', 'industrial', 'otro'];

/** Convierte un valor a numero; devuelve null si no es usable. */
function aNumeroOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Valida la lista de comparables enviada por el frontend (2 a 5 elementos).
 * @returns {{ errores: string[], comparables: object[] | undefined }}
 */
function validarComparables(valor) {
  if (valor === undefined || valor === null) {
    return { errores: [], comparables: undefined };
  }

  if (!Array.isArray(valor)) {
    return { errores: ['"comparables" debe ser un arreglo.'], comparables: undefined };
  }

  const errores = [];

  if (valor.length < 2 || valor.length > 5) {
    errores.push('"comparables" debe contener entre 2 y 5 elementos.');
  }

  const comparables = valor.map((item, indice) => {
    const origen = item && typeof item === 'object' ? item : {};

    const superficieM2 = Number(origen.superficieM2);
    const precio = Number(origen.precio);
    const distanciaBruta = origen.distanciaKm;
    const distanciaKm =
      distanciaBruta === undefined || distanciaBruta === null || distanciaBruta === ''
        ? undefined
        : Number(distanciaBruta);

    if (!Number.isFinite(superficieM2) || superficieM2 <= 0) {
      errores.push(`comparables[${indice}].superficieM2 debe ser un numero mayor a 0.`);
    }

    if (!Number.isFinite(precio) || precio <= 0) {
      errores.push(`comparables[${indice}].precio debe ser un numero mayor a 0.`);
    }

    if (distanciaKm !== undefined && (!Number.isFinite(distanciaKm) || distanciaKm < 0)) {
      errores.push(`comparables[${indice}].distanciaKm debe ser un numero mayor o igual a 0.`);
    }

    const comparable = { superficieM2, precio };

    if (distanciaKm !== undefined) {
      comparable.distanciaKm = distanciaKm;
    }

    const nota = typeof origen.nota === 'string' ? origen.nota.trim() : '';
    if (nota) {
      comparable.nota = nota;
    }

    return comparable;
  });

  return { errores, comparables };
}

/**
 * Valida los campos minimos del payload recibido.
 * @returns {{ errores: string[], datos: object }}
 */
function validarPayload(body) {
  const errores = [];
  const datos = body && typeof body === 'object' ? body : {};

  const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

  const comuna = texto(datos.comuna);
  const tipoPropiedad = texto(datos.tipoPropiedad).toLowerCase();
  const superficieUtil = Number(datos.superficieUtil);

  if (!comuna) {
    errores.push('"comuna" es obligatorio y debe ser texto.');
  }

  if (!tipoPropiedad) {
    errores.push('"tipoPropiedad" es obligatorio (casa, departamento, oficina, terreno...).');
  } else if (!TIPOS_PROPIEDAD.includes(tipoPropiedad)) {
    errores.push(`"tipoPropiedad" debe ser uno de: ${TIPOS_PROPIEDAD.join(', ')}.`);
  }

  if (!Number.isFinite(superficieUtil) || superficieUtil <= 0) {
    errores.push('"superficieUtil" es obligatorio y debe ser un numero mayor a 0 (m2).');
  }

  const opcionalNumero = (valor, campo, min) => {
    if (valor === undefined || valor === null || valor === '') return undefined;
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < min) {
      errores.push(`"${campo}" debe ser un numero mayor o igual a ${min}.`);
      return undefined;
    }
    return numero;
  };

  const { errores: erroresComparables, comparables } = validarComparables(datos.comparables);
  errores.push(...erroresComparables);

  const payload = {
    comuna,
    tipoPropiedad,
    superficieUtil,
    direccion: texto(datos.direccion) || undefined,
    dormitorios: opcionalNumero(datos.dormitorios, 'dormitorios', 0),
    banos: opcionalNumero(datos.banos, 'banos', 0),
    estacionamientos: opcionalNumero(datos.estacionamientos, 'estacionamientos', 0),
    anioConstruccion: opcionalNumero(datos.anioConstruccion, 'anioConstruccion', 1800),
    antiguedad: opcionalNumero(datos.antiguedad, 'antiguedad', 0),
    precioReferencia: opcionalNumero(datos.precioReferencia, 'precioReferencia', 0),
    estadoConservacion: texto(datos.estadoConservacion) || undefined,
    observaciones: texto(datos.observaciones) || undefined,
    comparables
  };

  // Elimina claves sin valor para no enviar ruido al modelo
  Object.keys(payload).forEach((clave) => {
    if (payload[clave] === undefined) delete payload[clave];
  });

  return { errores, datos: payload };
}

/**
 * POST /api/tasacion
 * Recibe los datos de la propiedad, los valida y delega el calculo al servicio.
 */
async function crearTasacion(req, res, next) {
  try {
    const { errores, datos } = validarPayload(req.body);

    if (errores.length > 0) {
      return res.status(400).json({
        ok: false,
        error: {
          codigo: 'VALIDACION',
          mensaje: 'Los datos enviados no son validos.',
          detalles: errores
        }
      });
    }

    const { resultado, meta } = await calcularTasacion(datos);

    // ---------- Persistencia en el historial (solo si DeepSeek respondio OK) ----------
    const metaRespuesta = { ...meta };

    try {
      const { id } = await guardarTasacion({
        comuna: datos.comuna,
        tipo: datos.tipoPropiedad,
        superficie: datos.superficieUtil,
        valorReferencia: aNumeroOpcional(resultado && resultado.valorReferencia),
        datos: { data: resultado, meta }
      });

      metaRespuesta.historialId = id;
      metaRespuesta.persistido = true;
    } catch (errorBaseDatos) {
      // Un fallo al guardar no debe invalidar una tasacion ya calculada:
      // se registra en el log y se responde igualmente con el resultado.
      console.error('[tasacion.controller] No fue posible guardar en el historial:', errorBaseDatos);
      metaRespuesta.persistido = false;
    }

    return res.status(200).json({
      ok: true,
      data: resultado,
      meta: metaRespuesta
    });
  } catch (error) {
    // Errores previstos del servicio (config, red, timeout, JSON invalido...)
    if (error && error.codigo) {
      return res.status(error.status || 502).json({
        ok: false,
        error: {
          codigo: error.codigo,
          mensaje: error.mensaje || 'No fue posible calcular la tasacion.'
        }
      });
    }

    return next(error);
  }
}

/**
 * GET /api/tasaciones
 * Devuelve el historial de tasaciones guardadas, de la mas reciente a la mas
 * antigua. Acepta el parametro opcional ?limite=N (1-500, por defecto 100).
 */
async function obtenerHistorial(req, res) {
  try {
    const tasaciones = await listarTasaciones({ limite: req.query.limite });

    return res.status(200).json({
      ok: true,
      data: tasaciones,
      meta: { total: tasaciones.length }
    });
  } catch (error) {
    console.error('[tasacion.controller] Error al leer el historial:', error);

    return res.status(500).json({
      ok: false,
      error: {
        codigo: 'DB_ERROR',
        mensaje: 'No fue posible leer el historial de tasaciones.'
      }
    });
  }
}

module.exports = {
  crearTasacion,
  obtenerHistorial,
  validarPayload,
  validarComparables
};
