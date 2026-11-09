'use strict';

/**
 * Modelo normalizado del informe de tasacion.
 *
 * Tanto la exportacion a Excel como la exportacion a PDF consumen este mismo
 * objeto, de modo que ambos formatos muestren exactamente los mismos datos y
 * con el mismo formato (pesos chilenos, m2, factores, etc.).
 *
 * La entrada es el cuerpo que envia el frontend:
 *   { datos: {...}, resultado: {...}, meta: {...} }
 * Tambien se acepta la forma { data, meta } que devuelve POST /api/tasacion,
 * para que el endpoint de exportacion pueda usarse con esa respuesta tal cual.
 */

// ---------- Formateadores (mismos criterios que public/js/app.js) ----------
const fmtCLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
});
const fmtDecimal = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
const fmtFactor = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmtFecha = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeStyle: 'short' });

/** Convierte un valor a numero; devuelve null si no es usable. */
function aNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Devuelve el texto recortado o cadena vacia si el valor no es texto util. */
function textoOpcional(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** Pone en mayuscula la primera letra (los tipos llegan en minuscula). */
function capitalizar(valor) {
  const texto = textoOpcional(valor);
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '';
}

/** Formatea un monto en CLP; si no hay valor devuelve el texto alternativo. */
function formatearCLP(valor, alterno = 'No informado') {
  const numero = aNumero(valor);
  return numero === null ? alterno : fmtCLP.format(numero);
}

/** Formatea un numero con separador de miles chileno. */
function formatearNumero(valor, alterno = '—') {
  const numero = aNumero(valor);
  return numero === null ? alterno : fmtDecimal.format(numero);
}

/** Formatea un factor de ajuste con dos decimales fijos. */
function formatearFactor(valor, alterno = '—') {
  const numero = aNumero(valor);
  return numero === null ? alterno : fmtFactor.format(numero);
}

/** Formatea una fecha ISO; devuelve el texto alternativo si no es valida. */
function formatearFecha(valor, alterno = '—') {
  if (!valor) return alterno;

  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return alterno;

  return fmtFecha.format(fecha);
}

/** Convierte un objeto plano en objeto (descarta null, arreglos y primitivos). */
function comoObjeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

/** Devuelve el valor si es un arreglo; si no, un arreglo vacio. */
function comoLista(valor) {
  return Array.isArray(valor)
    ? valor.filter((item) => item !== null && item !== undefined)
    : [];
}

/**
 * Separa el cuerpo recibido en sus tres bloques.
 * @returns {{ datos: object, resultado: object, meta: object }}
 */
function separarEntrada(entrada) {
  const cuerpo = comoObjeto(entrada);

  return {
    datos: comoObjeto(cuerpo.datos || cuerpo.propiedad),
    resultado: comoObjeto(cuerpo.resultado || cuerpo.data),
    meta: comoObjeto(cuerpo.meta)
  };
}

/** Filas etiqueta/valor con los datos declarados del inmueble. */
function construirDatosInmueble(datos) {
  const superficie = aNumero(datos.superficieUtil);

  const filas = [
    ['Tipo de inmueble', capitalizar(datos.tipoPropiedad) || '—'],
    ['Comuna', textoOpcional(datos.comuna) || '—'],
    ['Superficie útil', superficie === null ? '—' : `${formatearNumero(superficie)} m²`]
  ];

  const direccion = textoOpcional(datos.direccion);
  if (direccion) filas.push(['Dirección', direccion]);

  [
    ['dormitorios', 'Dormitorios'],
    ['banos', 'Baños'],
    ['estacionamientos', 'Estacionamientos'],
    ['antiguedad', 'Antigüedad (años)'],
    ['anioConstruccion', 'Año de construcción']
  ].forEach(([campo, etiqueta]) => {
    if (aNumero(datos[campo]) !== null) {
      filas.push([etiqueta, formatearNumero(datos[campo])]);
    }
  });

  if (aNumero(datos.precioReferencia) !== null) {
    filas.push(['Precio de referencia', formatearCLP(datos.precioReferencia)]);
  }

  const estado = textoOpcional(datos.estadoConservacion);
  if (estado) filas.push(['Estado de conservación', capitalizar(estado)]);

  const observaciones = textoOpcional(datos.observaciones);
  if (observaciones) filas.push(['Observaciones', observaciones]);

  return filas;
}

/** Comparables tal como los devuelve el modelo, ya normalizados. */
function construirComparables(resultado, datos) {
  return comoLista(resultado.comparables)
    .filter((item) => item && typeof item === 'object')
    .map((item, indice) => {
      const valorM2 = aNumero(item.valorM2);
      const factor = aNumero(item.factorAjuste);

      return {
        referencia: textoOpcional(item.referencia) || `Comparable ${indice + 1}`,
        comuna: textoOpcional(item.comuna) || textoOpcional(datos.comuna) || '—',
        superficieM2: aNumero(item.superficieM2),
        valorM2,
        factorAjuste: factor,
        // Derivado: valor por m2 del comparable una vez aplicado su factor
        valorM2Ajustado: valorM2 !== null && factor !== null ? valorM2 * factor : null,
        justificacion: textoOpcional(item.justificacion) || '—'
      };
    });
}

/** Factores de ajuste aplicados por el modelo. */
function construirFactores(resultado) {
  return comoLista(resultado.factoresAjuste)
    .filter((item) => item && typeof item === 'object')
    .map((item, indice) => ({
      factor: textoOpcional(item.factor) || `Factor ${indice + 1}`,
      valor: aNumero(item.valor),
      justificacion: textoOpcional(item.justificacion) || '—'
    }));
}

/** Advertencias declaradas por el modelo (solo textos no vacios). */
function construirAdvertencias(resultado) {
  return comoLista(resultado.advertencias)
    .map((item) => textoOpcional(item))
    .filter((item) => item.length > 0);
}

/**
 * Construye el modelo del informe a partir del cuerpo recibido.
 * @param {object} entrada Cuerpo de la peticion de exportacion.
 * @returns {object} Informe normalizado, listo para Excel o PDF.
 */
function construirInforme(entrada) {
  const { datos, resultado, meta } = separarEntrada(entrada);
  const valorM2 = comoObjeto(resultado.valorM2);
  const rango = comoObjeto(resultado.rango);

  const minimo = aNumero(rango.minimo);
  const maximo = aNumero(rango.maximo);

  const rangoTexto =
    minimo !== null && maximo !== null
      ? `${formatearCLP(minimo)}  –  ${formatearCLP(maximo)}`
      : 'Rango no informado';

  const generadoEn = new Date();

  return {
    generadoEn,
    generadoEnTexto: formatearFecha(generadoEn),
    datosInmueble: construirDatosInmueble(datos),
    valorReferencia: aNumero(resultado.valorReferencia),
    valorReferenciaTexto: formatearCLP(resultado.valorReferencia, 'No determinado'),
    rango: { minimo, maximo },
    rangoTexto,
    valorM2: aNumero(valorM2.calculado),
    valorM2Texto: formatearCLP(valorM2.calculado, 'No informado'),
    valorM2Justificacion: textoOpcional(valorM2.justificacion),
    moneda: textoOpcional(valorM2.moneda) || 'CLP',
    resumen: textoOpcional(resultado.resumen) || 'El modelo no entregó una conclusión textual.',
    comparables: construirComparables(resultado, datos),
    factores: construirFactores(resultado),
    advertencias: construirAdvertencias(resultado),
    meta: {
      modelo: textoOpcional(meta.modelo) || 'DeepSeek',
      generadoEnTexto: formatearFecha(meta.generadoEn, ''),
      reconstruido: meta.reconstruido === true
    },
    datos
  };
}

/** Quita acentos y caracteres no seguros para usar el texto en un nombre de archivo. */
function limpiarNombre(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Construye un nombre de archivo seguro (ASCII) para la descarga.
 * Ej: tasacion-providencia-2026-11-08.xlsx
 * @param {string} extension Extension sin punto (xlsx, pdf).
 * @param {object} datos Datos del inmueble (solo se usa `comuna`).
 */
function construirNombreArchivo(extension, datos) {
  const comuna = limpiarNombre(datos && datos.comuna) || 'propiedad';
  const fecha = new Date().toISOString().slice(0, 10);

  return `tasacion-${comuna}-${fecha}.${extension}`;
}

module.exports = {
  construirInforme,
  construirNombreArchivo,
  formatearCLP,
  formatearNumero,
  formatearFactor,
  formatearFecha,
  capitalizar,
  textoOpcional,
  aNumero
};
