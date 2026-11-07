'use strict';

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MODELO_DEEPSEEK = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 60000;
const MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 4096;
// Tope al que se puede ampliar max_tokens cuando la respuesta viene truncada
const MAX_TOKENS_LIMITE = Number(process.env.DEEPSEEK_MAX_TOKENS_LIMITE) || 8192;
// Intentos maximos por tasacion (cubre contenido vacio y respuestas truncadas)
const MAX_INTENTOS = Number(process.env.DEEPSEEK_MAX_INTENTOS) || 3;

const PROMPT_SISTEMA =
  'Eres un tasador experto chileno. Calcula valor por m2, factores de ajuste (0.85 a 1.15), ' +
  'y devuelve estrictamente un JSON con comparables, valor de referencia, rango y advertencias. ' +
  'IMPORTANTE: Tu respuesta debe ser ÚNICAMENTE el objeto JSON válido, sin texto adicional, ' +
  'sin bloques de código markdown (```json), sin explicaciones. Debe empezar con { y terminar con }.';

// Ejemplo del JSON esperado: obligatorio para que response_format json_object
// devuelva contenido util (ver guia "JSON Output" de DeepSeek).
const ESQUEMA_RESPUESTA = {
  resumen: 'string',
  valorM2: {
    calculado: 0,
    moneda: 'CLP',
    justificacion: 'string'
  },
  comparables: [
    {
      referencia: 'string',
      comuna: 'string',
      superficieM2: 0,
      valorM2: 0,
      factorAjuste: 1,
      justificacion: 'string'
    }
  ],
  factoresAjuste: [
    {
      factor: 'string',
      valor: 1,
      justificacion: 'string'
    }
  ],
  valorReferencia: 0,
  rango: {
    minimo: 0,
    maximo: 0
  },
  advertencias: ['string']
};

/**
 * Error de dominio del servicio: transporta codigo y status HTTP sugerido.
 */
class ErrorServicio extends Error {
  constructor(mensaje, codigo, status = 502) {
    super(mensaje);
    this.name = 'ErrorServicio';
    // Se expone tambien como "mensaje" porque el controller y el error handler
    // central de server.js leen err.mensaje para armar la respuesta JSON.
    this.mensaje = mensaje;
    this.codigo = codigo;
    this.status = status;
  }
}

/**
 * Construye el mensaje de usuario con los datos de la propiedad y el contrato de salida.
 */
function construirMensajeUsuario(datosPropiedad) {
  return [
    'Tasa la siguiente propiedad en Chile.',
    'Datos de la propiedad (JSON):',
    JSON.stringify(datosPropiedad, null, 2),
    '',
    'Reglas:',
    '- Trabaja en pesos chilenos (CLP) y usa valores de mercado realistas de la comuna indicada.',
    '- Cada factor de ajuste debe estar entre 0.85 y 1.15.',
    '- Si el usuario entrega "comparables", usalos como base principal del analisis, calcula su factor de ajuste y refleja cada uno en la lista de comparables.',
    '- Si el usuario entrega "precioReferencia", comparalo con tu estimacion y menciona la diferencia en el resumen o en las advertencias.',
    '- Si falta informacion, usa supuestos prudentes y declaralos en "advertencias".',
    '- Responde EXCLUSIVAMENTE con un objeto json valido, sin texto adicional ni bloques markdown.',
    '',
    'Ejemplo del json de salida esperado:',
    JSON.stringify(ESQUEMA_RESPUESTA, null, 2)
  ].join('\n');
}

/**
 * Sanitiza el contenido devuelto por el modelo antes de parsearlo.
 *   1) Elimina las vallas de bloques markdown (``` o ```json).
 *   2) Recorta desde la PRIMERA llave "{" hasta la ULTIMA llave "}".
 * Devuelve el fragmento candidato a JSON (puede quedar vacio o invalido).
 */
function limpiarRespuesta(texto) {
  const bruto = typeof texto === 'string'
    ? texto
    : String(texto === null || texto === undefined ? '' : texto);

  // 1) Quita las vallas de codigo markdown esten donde esten, sin borrar el contenido
  const sinVallas = bruto.replace(/```(?:json)?/gi, ' ').trim();

  // 2) Se queda solo con el fragmento entre la primera y la ultima llave
  const inicio = sinVallas.indexOf('{');
  const fin = sinVallas.lastIndexOf('}');

  if (inicio === -1 || fin === -1 || fin <= inicio) {
    return sinVallas;
  }

  return sinVallas.slice(inicio, fin + 1);
}

/**
 * Parsea el contenido devuelto por el modelo aplicando limpieza previa.
 */
function extraerJSON(texto) {
  const limpio = limpiarRespuesta(texto);

  try {
    return JSON.parse(limpio);
  } catch (error) {
    // El fragmento queda en el log del servidor para diagnostico,
    // pero no se expone al cliente.
    console.error('[deepseek.service] JSON invalido. Fragmento recibido:', limpio.slice(0, 500));
    throw new ErrorServicio(
      'La respuesta del modelo no es un JSON valido.',
      'DEEPSEEK_JSON_INVALIDO',
      502
    );
  }
}

/**
 * Ejecuta UNA llamada HTTP al endpoint de chat completions de DeepSeek.
 * @param {object} datosPropiedad Datos ya validados de la propiedad.
 * @param {string} apiKey Clave de la API de DeepSeek.
 * @param {number} [maxTokens] Presupuesto de tokens de salida para esta llamada.
 * @returns {Promise<{ json: object, contenido: string, vacio: boolean, truncado: boolean, finishReason: string | null }>}
 */
async function solicitarTasacion(datosPropiedad, apiKey, maxTokens = MAX_TOKENS) {
  const cuerpo = {
    model: MODELO_DEEPSEEK,
    messages: [
      { role: 'system', content: PROMPT_SISTEMA },
      { role: 'user', content: construirMensajeUsuario(datosPropiedad) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false
  };

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(cuerpo),
      signal: controlador.signal
    });

    const textoRespuesta = await respuesta.text();

    if (!respuesta.ok) {
      const detalle = textoRespuesta ? textoRespuesta.slice(0, 500) : 'sin detalle';
      throw new ErrorServicio(
        `DeepSeek respondio HTTP ${respuesta.status}: ${detalle}`,
        'DEEPSEEK_HTTP_ERROR',
        502
      );
    }

    let json;
    try {
      json = JSON.parse(textoRespuesta);
    } catch (error) {
      throw new ErrorServicio(
        'DeepSeek devolvio una respuesta que no es JSON.',
        'DEEPSEEK_RESPUESTA_INVALIDA',
        502
      );
    }

    const eleccion = json && Array.isArray(json.choices) ? json.choices[0] : null;
    const contenido = eleccion && eleccion.message ? eleccion.message.content || '' : '';
    const finishReason = eleccion ? eleccion.finish_reason || null : null;

    // "length" = el modelo agoto max_tokens: el JSON puede venir cortado a la mitad
    const truncado = finishReason === 'length';

    return { json, contenido, vacio: contenido.trim().length === 0, truncado, finishReason };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ErrorServicio(
        `La API de DeepSeek no respondio en ${TIMEOUT_MS} ms.`,
        'DEEPSEEK_TIMEOUT',
        504
      );
    }

    if (error instanceof ErrorServicio) {
      throw error;
    }

    throw new ErrorServicio(
      `Error de red al contactar la API de DeepSeek: ${error && error.message}`,
      'DEEPSEEK_NETWORK_ERROR',
      502
    );
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Calcula la tasacion de una propiedad usando DeepSeek.
 * @param {object} datosPropiedad Datos ya validados por el controller.
 * @returns {Promise<{ resultado: object, meta: object }>}
 */
async function calcularTasacion(datosPropiedad) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new ErrorServicio(
      'Falta configurar DEEPSEEK_API_KEY en las variables de entorno del servidor.',
      'CONFIG_ERROR',
      500
    );
  }

  const inicio = Date.now();

  let maxTokens = MAX_TOKENS;
  let intento = null;
  let motivoFallo = null;

  for (let numeroIntento = 1; numeroIntento <= MAX_INTENTOS; numeroIntento += 1) {
    intento = await solicitarTasacion(datosPropiedad, apiKey, maxTokens);

    // 1) Contenido vacio: se reintenta con el mismo presupuesto de tokens
    if (intento.vacio) {
      motivoFallo = 'vacio';
      continue;
    }

    // 2) Respuesta truncada por max_tokens: se duplica el presupuesto y se reintenta
    if (intento.truncado) {
      motivoFallo = 'truncado';
      const ampliado = Math.min(maxTokens * 2, MAX_TOKENS_LIMITE);

      if (ampliado > maxTokens) {
        maxTokens = ampliado;
        console.warn(
          `[deepseek.service] Respuesta truncada (finish_reason=length). ` +
          `Reintentando con max_tokens=${maxTokens}.`
        );
        continue;
      }

      // Ya se alcanzo el tope permitido: reintentar no aportaria nada
      break;
    }

    motivoFallo = null;
    break;
  }

  if (!intento) {
    throw new ErrorServicio(
      'No fue posible obtener una respuesta de DeepSeek (revisa DEEPSEEK_MAX_INTENTOS).',
      'DEEPSEEK_SIN_RESPUESTA',
      502
    );
  }

  if (motivoFallo === 'vacio') {
    throw new ErrorServicio(
      'DeepSeek devolvio contenido vacio para el formato json solicitado.',
      'DEEPSEEK_SIN_CONTENIDO',
      502
    );
  }

  if (motivoFallo === 'truncado') {
    throw new ErrorServicio(
      `DeepSeek trunco la respuesta por limite de tokens (max_tokens=${maxTokens}). ` +
      'Aumenta DEEPSEEK_MAX_TOKENS (y/o DEEPSEEK_MAX_TOKENS_LIMITE) en el archivo .env e intenta nuevamente.',
      'DEEPSEEK_TRUNCADO',
      502
    );
  }

  const resultado = extraerJSON(intento.contenido);

  return {
    resultado,
    meta: {
      modelo: intento.json.model || MODELO_DEEPSEEK,
      uso: intento.json.usage || null,
      finishReason: intento.finishReason,
      maxTokens,
      latenciaMs: Date.now() - inicio,
      generadoEn: new Date().toISOString()
    }
  };
}

module.exports = {
  calcularTasacion,
  construirMensajeUsuario,
  limpiarRespuesta,
  extraerJSON,
  ErrorServicio,
  PROMPT_SISTEMA,
  MODELO_DEEPSEEK,
  ESQUEMA_RESPUESTA
};
