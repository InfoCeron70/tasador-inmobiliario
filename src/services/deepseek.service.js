'use strict';

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MODELO_DEEPSEEK = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 120000;
// Presupuesto de salida. OJO: en los modelos con razonamiento (reasoning_content)
// los tokens de pensamiento consumen este mismo presupuesto, por eso el valor por
// defecto debe dejar margen suficiente para el JSON final.
const MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 8192;
// Tope al que se puede ampliar max_tokens cuando la respuesta viene truncada
const MAX_TOKENS_LIMITE = Number(process.env.DEEPSEEK_MAX_TOKENS_LIMITE) || 32768;
// Intentos maximos por tasacion (cubre contenido vacio y respuestas truncadas)
const MAX_INTENTOS = Number(process.env.DEEPSEEK_MAX_INTENTOS) || 3;
// Diagnostico: con DEBUG_DEEPSEEK=1 se imprime el contenido crudo devuelto por el modelo
const DEBUG_DEEPSEEK = process.env.DEBUG_DEEPSEEK === '1';

// Instruccion final que debe cerrar el prompt: contrato estricto de salida JSON.
// IMPORTANTE: no incluir vallas ``` en el prompt, el modelo tiende a replicarlas.
const PROMPT_SISTEMA =
  'Eres un tasador experto chileno. Calcula valor por m2, factores de ajuste (0.85 a 1.15), ' +
  'y devuelve estrictamente un JSON con comparables, valor de referencia, rango y advertencias. ' +
  'En "factoresAjuste" nombra cada factor con el comparable y la variable ajustada ' +
  '("Comparable 1 - Superficie", "Comparable 1 - Distancia", "Comparable 2 - Superficie") y ' +
  'agrupa los factores por comparable en ese orden; los factores generales van al final con un ' +
  'nombre descriptivo (por ejemplo "Antigüedad y estado"). Nunca uses abreviaturas como C1 o C2. ' +
  'Se conciso: el resumen y cada justificacion deben tener como maximo 40 palabras. ' +
  'IMPORTANTE: Tu respuesta debe ser ÚNICAMENTE el objeto JSON válido, sin texto adicional, ' +
  'sin bloques de markdown, sin explicaciones. Debe empezar con { y terminar con }.';

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
      factor: 'Comparable 1 - Superficie',
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
    '- En "factoresAjuste" usa nombres descriptivos que indiquen el comparable y la variable: ' +
      '"Comparable 1 - Superficie", "Comparable 1 - Distancia", "Comparable 2 - Superficie", "Comparable 2 - Distancia". ' +
      'Agrupa los factores por comparable y en orden; los factores que no dependen de un comparable ' +
      'van al final con un nombre claro (por ejemplo "Antigüedad y estado"). No uses abreviaturas como C1 o C2.',
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

/** Tokens de razonamiento consumidos por el modelo (0 si no aplica). */
function tokensDeRazonamiento(json) {
  const detalles = json && json.usage && json.usage.completion_tokens_details;
  const valor = detalles ? Number(detalles.reasoning_tokens) : 0;
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/**
 * Recorre el fragmento llevando la pila de estructuras abiertas y registrando
 * los "puntos de corte seguros" (posiciones justo despues de un valor completo).
 * @returns {{ pila: string[], enCadena: boolean, puntos: { indice: number, cierres: string }[] }}
 */
function analizarFragmento(texto) {
  const pila = [];
  const puntos = [];
  let enCadena = false;
  let escapado = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];

    if (enCadena) {
      if (escapado) {
        escapado = false;
      } else if (caracter === '\\') {
        escapado = true;
      } else if (caracter === '"') {
        enCadena = false;
        if (pila.length > 0) {
          puntos.push({ indice: i + 1, cierres: [...pila].reverse().join('') });
        }
      }
      continue;
    }

    if (caracter === '"') {
      enCadena = true;
    } else if (caracter === '{') {
      pila.push('}');
    } else if (caracter === '[') {
      pila.push(']');
    } else if (caracter === '}' || caracter === ']') {
      pila.pop();
      if (pila.length > 0) {
        puntos.push({ indice: i + 1, cierres: [...pila].reverse().join('') });
      }
    } else if (/[0-9]/.test(caracter)) {
      const siguiente = texto[i + 1];
      const sigueNumero = siguiente !== undefined && /[0-9eE.+-]/.test(siguiente);
      if (!sigueNumero && pila.length > 0) {
        puntos.push({ indice: i + 1, cierres: [...pila].reverse().join('') });
      }
    }
  }

  return { pila, enCadena, puntos };
}

/**
 * Intenta reconstruir un JSON cortado a mitad (finish_reason=length) o con un
 * defecto de formato. Prueba varias estrategias y devuelve el primer resultado
 * que JSON.parse acepte.
 * @param {string} fragmento
 * @returns {object|null} Objeto reconstruido o null si no fue posible.
 */
function repararJSONCortado(fragmento) {
  const texto = String(fragmento === null || fragmento === undefined ? '' : fragmento).trim();
  if (!texto) return null;

  try {
    return JSON.parse(texto);
  } catch (error) {
    // continua con la reconstruccion
  }

  const { pila, enCadena, puntos } = analizarFragmento(texto);
  const cierres = [...pila].reverse().join('');
  const candidatos = [];

  // 1) Quitar una coma final y cerrar las estructuras pendientes
  candidatos.push(texto.replace(/,\s*$/, '') + cierres);

  // 2) La respuesta se corto dentro de una cadena: se cierra y luego las estructuras
  if (enCadena) {
    candidatos.push(texto + '"' + cierres);
    // Miembro incompleto tipo  ,"clave":  -> se descarta el miembro
    candidatos.push(texto.replace(/,\s*"[^"]*"\s*:\s*$/, '') + cierres);
  }

  // 3) Cortar en el ultimo valor completo y cerrar lo que quedo abierto
  for (let i = puntos.length - 1, intentos = 0; i >= 0 && intentos < 25; i -= 1, intentos += 1) {
    const corte = puntos[i];
    candidatos.push(texto.slice(0, corte.indice).replace(/,\s*$/, '') + corte.cierres);
  }

  for (const candidato of candidatos) {
    try {
      const objeto = JSON.parse(candidato);
      if (objeto && typeof objeto === 'object') {
        console.warn('[deepseek.service] JSON reconstruido a partir de una respuesta incompleta.');
        return objeto;
      }
    } catch (error) {
      // se prueba el siguiente candidato
    }
  }

  return null;
}

/**
 * Reconstruye el resultado cuando el modelo trunco o malformo el JSON.
 * Agrega una advertencia para que el usuario sepa que los datos son parciales.
 * @param {string} contenido Texto crudo devuelto por el modelo.
 * @returns {object|null}
 */
function reconstruirResultadoParcial(contenido) {
  const reparado = repararJSONCortado(limpiarRespuesta(contenido));
  if (!reparado) return null;

  const advertencias = Array.isArray(reparado.advertencias)
    ? reparado.advertencias.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : [];

  advertencias.push(
    'La respuesta del modelo se corto antes de terminar: los datos se reconstruyeron de forma ' +
    'parcial, revisa los campos y vuelve a intentarlo si necesitas el detalle completo.'
  );

  return { ...reparado, advertencias };
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

    // ===================== LOG DE DIAGNOSTICO (opcional) =====================
    // Activar con DEBUG_DEEPSEEK=1 para ver exactamente que devuelve DeepSeek.
    if (DEBUG_DEEPSEEK) {
      console.log('[DIAG deepseek] finish_reason:', finishReason);
      console.log('[DIAG deepseek] caracteres recibidos:', contenido.length);
      console.log('[DIAG deepseek] usage:', JSON.stringify(json && json.usage));
      console.log('[DIAG deepseek] contenido completo:\n' + contenido);
    }
    // ========================================================================

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

    // 2) Respuesta truncada por max_tokens: se amplia el presupuesto y se reintenta.
    //    Si el modelo gasto casi todo el presupuesto razonando (reasoning_tokens),
    //    duplicar no basta: se calcula un presupuesto sobre el pensamiento real.
    if (intento.truncado) {
      motivoFallo = 'truncado';
      const razonamiento = tokensDeRazonamiento(intento.json);
      const sugerido = razonamiento > 0 ? razonamiento * 2 + MAX_TOKENS : maxTokens * 2;
      const ampliado = Math.min(Math.max(maxTokens * 2, sugerido), MAX_TOKENS_LIMITE);

      if (ampliado > maxTokens) {
        maxTokens = ampliado;
        console.warn(
          '[deepseek.service] Respuesta truncada (finish_reason=length). ' +
          `Tokens de razonamiento: ${razonamiento}. Reintentando con max_tokens=${maxTokens}.`
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

  // Si el JSON llego cortado o malformado se intenta reconstruir en lugar de
  // devolver un error: es preferible una tasacion parcial y advertida a un 502.
  let resultado = null;
  let reconstruido = false;

  if (motivoFallo === 'truncado') {
    resultado = reconstruirResultadoParcial(intento.contenido);
    reconstruido = Boolean(resultado);

    if (!resultado) {
      throw new ErrorServicio(
        `DeepSeek trunco la respuesta por limite de tokens (max_tokens=${maxTokens}). ` +
        'Aumenta DEEPSEEK_MAX_TOKENS (y/o DEEPSEEK_MAX_TOKENS_LIMITE) en el archivo .env e intenta nuevamente.',
        'DEEPSEEK_TRUNCADO',
        502
      );
    }
  } else {
    try {
      resultado = extraerJSON(intento.contenido);
    } catch (errorJSON) {
      if (!errorJSON || errorJSON.codigo !== 'DEEPSEEK_JSON_INVALIDO') throw errorJSON;

      resultado = reconstruirResultadoParcial(intento.contenido);
      reconstruido = Boolean(resultado);

      if (!resultado) throw errorJSON;
    }
  }

  return {
    resultado,
    meta: {
      modelo: intento.json.model || MODELO_DEEPSEEK,
      uso: intento.json.usage || null,
      finishReason: intento.finishReason,
      maxTokens,
      razonamientoTokens: tokensDeRazonamiento(intento.json),
      reconstruido,
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
  repararJSONCortado,
  reconstruirResultadoParcial,
  analizarFragmento,
  ErrorServicio,
  PROMPT_SISTEMA,
  MODELO_DEEPSEEK,
  ESQUEMA_RESPUESTA
};
