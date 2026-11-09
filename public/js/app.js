'use strict';

/* =========================================================
   Tasación Inmobiliaria IA · lógica del frontend
   Envía el formulario a POST /api/tasacion y renderiza el resultado.
   ========================================================= */

const MIN_COMPARABLES = 2;
const MAX_COMPARABLES = 5;
const ENDPOINT = '/api/tasacion';
const ENDPOINT_HISTORIAL = '/api/tasaciones';
const ENDPOINT_EXPORT_PDF = '/api/exportar/pdf';
const ENDPOINT_EXPORT_EXCEL = '/api/exportar/excel';
const LIMITE_HISTORIAL = 200;

// ---------- Referencias del DOM ----------
const form = document.getElementById('tasacion-form');
const contenedorComparables = document.getElementById('comparables-container');
const plantillaComparable = document.getElementById('tpl-comparable');
const btnAgregar = document.getElementById('btn-agregar-comparable');
const btnGenerar = document.getElementById('btn-generar');
const contadorComparables = document.getElementById('contador-comparables');

const seccionResultados = document.getElementById('resultados');
const spinner = document.getElementById('spinner');
const errorPeticion = document.getElementById('error-peticion');
const resultadoContenido = document.getElementById('resultado-contenido');
const btnDescargarPDF = document.getElementById('btn-descargar-pdf');
const btnDescargarExcel = document.getElementById('btn-descargar-excel');
const btnNuevaTasacion = document.getElementById('btn-nueva-tasacion');

// Última tasación generada: se reutiliza para las descargas en PDF y Excel
let ultimaTasacion = null;

// ---------- Referencias del historial ----------
const btnHistorial = document.getElementById('btn-historial');
const seccionHistorial = document.getElementById('historial');
const btnActualizarHistorial = document.getElementById('btn-actualizar-historial');
const btnCerrarHistorial = document.getElementById('btn-cerrar-historial');
const historialCargando = document.getElementById('historial-cargando');
const historialError = document.getElementById('historial-error');
const historialVacio = document.getElementById('historial-vacio');
const historialTablaWrapper = document.getElementById('historial-tabla-wrapper');
const historialBody = document.getElementById('historial-body');
const historialContador = document.getElementById('historial-contador');

// ---------- Formateadores ----------
const fmtCLP = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
});
const fmtDecimal = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fmtFactor = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmtFecha = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });

/** Convierte un valor a número; devuelve null si no es usable. */
function aNumero(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/** Formatea un monto en CLP; devuelve un guion largo si no hay valor. */
function formatearCLP(valor) {
  const numero = aNumero(valor);
  return numero === null ? '—' : fmtCLP.format(numero);
}

/* =========================================================
   Comparables dinámicos (2 a 5 filas)
   ========================================================= */

function filasComparables() {
  return Array.from(contenedorComparables.querySelectorAll('[data-comparable]'));
}

function actualizarContador() {
  const total = filasComparables().length;
  contadorComparables.textContent =
    `Comparables agregados: ${total} · mínimo ${MIN_COMPARABLES}, máximo ${MAX_COMPARABLES}`;

  const limiteAlcanzado = total >= MAX_COMPARABLES;
  btnAgregar.disabled = limiteAlcanzado;
  btnAgregar.classList.toggle('opacity-50', limiteAlcanzado);
}

function eliminarComparable(fila) {
  if (filasComparables().length <= MIN_COMPARABLES) {
    alert(`Debes mantener al menos ${MIN_COMPARABLES} comparables.`);
    return;
  }
  fila.remove();
  actualizarContador();
}

function crearComparable() {
  if (filasComparables().length >= MAX_COMPARABLES) {
    alert(`Puedes agregar como máximo ${MAX_COMPARABLES} comparables.`);
    return;
  }

  const fragmento = plantillaComparable.content.cloneNode(true);
  const fila = fragmento.querySelector('[data-comparable]');
  fila.querySelector('[data-accion="eliminar"]')
    .addEventListener('click', () => eliminarComparable(fila));

  contenedorComparables.appendChild(fragmento);
  actualizarContador();
}

/** Extrae los datos de una fila de comparable. */
function leerComparable(fila) {
  const valor = (campo) => {
    const input = fila.querySelector(`[data-campo="${campo}"]`);
    return input ? input.value.trim() : '';
  };

  const comparable = {
    superficieM2: aNumero(valor('superficieM2')),
    precio: aNumero(valor('precio'))
  };

  const distancia = aNumero(valor('distanciaKm'));
  if (distancia !== null) comparable.distanciaKm = distancia;

  const nota = valor('nota');
  if (nota) comparable.nota = nota;

  return comparable;
}

/* =========================================================
   Payload, spinner y manejo de errores
   ========================================================= */

/** Construye el payload que espera POST /api/tasacion. */
function construirPayload() {
  const payload = {
    tipoPropiedad: document.getElementById('tipoPropiedad').value,
    superficieUtil: aNumero(document.getElementById('superficieUtil').value),
    comuna: document.getElementById('comuna').value.trim(),
    comparables: filasComparables().map(leerComparable)
  };

  const estado = document.getElementById('estadoConservacion').value;
  if (estado) payload.estadoConservacion = estado;

  ['dormitorios', 'banos', 'antiguedad'].forEach((campo) => {
    const numero = aNumero(document.getElementById(campo).value);
    if (numero !== null) payload[campo] = numero;
  });

  const precioReferencia = aNumero(document.getElementById('precioReferencia').value);
  if (precioReferencia !== null) payload.precioReferencia = precioReferencia;

  return payload;
}

/** Valida los comparables antes de enviar. Devuelve el mensaje de error o null. */
function validarComparables(comparables) {
  if (comparables.length < MIN_COMPARABLES || comparables.length > MAX_COMPARABLES) {
    return `Debes ingresar entre ${MIN_COMPARABLES} y ${MAX_COMPARABLES} comparables.`;
  }

  for (let i = 0; i < comparables.length; i += 1) {
    const comparable = comparables[i];
    if (comparable.superficieM2 === null || comparable.superficieM2 <= 0) {
      return `El comparable #${i + 1} necesita una superficie mayor a 0.`;
    }
    if (comparable.precio === null || comparable.precio <= 0) {
      return `El comparable #${i + 1} necesita un precio mayor a 0.`;
    }
  }

  return null;
}

function mostrarSpinner() {
  seccionResultados.classList.remove('hidden');
  resultadoContenido.classList.add('hidden');
  errorPeticion.classList.add('hidden');
  spinner.classList.remove('hidden');
  spinner.classList.add('flex');
  btnGenerar.disabled = true;
  seccionResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ocultarSpinner() {
  spinner.classList.add('hidden');
  spinner.classList.remove('flex');
  btnGenerar.disabled = false;
}

function mostrarError(mensaje) {
  errorPeticion.textContent = mensaje;
  errorPeticion.classList.remove('hidden');
  seccionResultados.classList.remove('hidden');
}

/* =========================================================
   Envío del formulario
   ========================================================= */

async function enviarTasacion(evento) {
  evento.preventDefault();

  const payload = construirPayload();

  const errorComparables = validarComparables(payload.comparables);
  if (errorComparables) {
    alert(errorComparables);
    return;
  }

  mostrarSpinner();

  try {
    const respuesta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const cuerpo = await respuesta.json().catch(() => null);

    if (!respuesta.ok || !cuerpo || cuerpo.ok !== true) {
      const detalles = cuerpo && cuerpo.error && Array.isArray(cuerpo.error.detalles)
        ? cuerpo.error.detalles.join('\n')
        : '';
      const mensaje = (cuerpo && cuerpo.error && cuerpo.error.mensaje) || `Error HTTP ${respuesta.status}`;
      throw new Error(detalles ? `${mensaje}\n\n${detalles}` : mensaje);
    }

    ocultarSpinner();

    // Se conserva el payload y el resultado para las descargas PDF / Excel
    ultimaTasacion = {
      datos: payload,
      resultado: cuerpo.data || {},
      meta: cuerpo.meta || {}
    };

    renderizarResultado(cuerpo.data || {}, cuerpo.meta || {});

    // Si el historial está abierto, se refresca con la tasación recién guardada
    if (!seccionHistorial.classList.contains('hidden')) {
      cargarHistorial();
    }
  } catch (error) {
    ocultarSpinner();
    const mensaje = (error && error.message) || 'No fue posible completar la solicitud.';
    mostrarError(mensaje);
    alert(`No fue posible generar la tasación:\n\n${mensaje}`);
  }
}

/* =========================================================
   Render de resultados
   ========================================================= */

/** Crea una celda <td> con texto seguro (sin innerHTML). */
function crearCelda(texto, clase) {
  const celda = document.createElement('td');
  celda.className = clase;
  celda.textContent = texto;
  return celda;
}

/** Devuelve el valor si es un arreglo; si no, un arreglo vacío. */
function comoLista(valor) {
  return Array.isArray(valor)
    ? valor.filter((item) => item !== null && item !== undefined)
    : [];
}

function renderizarResultado(data, meta) {
  const valorM2 = data.valorM2 || {};
  const rango = data.rango || {};
  const minimo = aNumero(rango.minimo);
  const maximo = aNumero(rango.maximo);

  // ---------- Valores destacados ----------
  document.getElementById('valor-referencia').textContent = formatearCLP(data.valorReferencia);

  document.getElementById('rango-valor').textContent =
    minimo !== null && maximo !== null
      ? `${formatearCLP(minimo)}  –  ${formatearCLP(maximo)}`
      : 'Rango no informado';

  // ---------- Valor por m²: el monto y el "/m²" viajan siempre juntos ----------
  const valorM2Calculado = aNumero(valorM2.calculado);
  const celdaValorM2 = document.getElementById('valor-m2');

  // whitespace-nowrap + espacio duro: el símbolo nunca cae a otra línea
  celdaValorM2.className =
    'mt-1 whitespace-nowrap text-xl font-extrabold tabular-nums text-white md:text-2xl';
  celdaValorM2.textContent =
    valorM2Calculado === null ? '—' : `${formatearCLP(valorM2Calculado)}\u00A0/m²`;

  // ---------- Conclusión ----------
  const resumen = typeof data.resumen === 'string' && data.resumen.trim()
    ? data.resumen.trim()
    : 'El modelo no entregó una conclusión textual.';
  document.getElementById('resumen-tasacion').textContent = resumen;

  renderizarTablaComparables(comoLista(data.comparables));
  renderizarFactores(comoLista(data.factoresAjuste));
  renderizarAdvertencias(comoLista(data.advertencias));

  // ---------- Metadatos del modelo ----------
  const partes = [];
  if (meta.modelo) partes.push(`Modelo: ${meta.modelo}`);
  if (meta.uso && aNumero(meta.uso.total_tokens) !== null) {
    partes.push(`${fmtDecimal.format(Number(meta.uso.total_tokens))} tokens`);
  }
  if (aNumero(meta.latenciaMs) !== null) {
    partes.push(`${fmtDecimal.format(Number(meta.latenciaMs))} ms`);
  }
  document.getElementById('meta-modelo').textContent =
    partes.length > 0 ? partes.join(' · ') : 'Análisis generado por IA.';

  // ---------- Mostrar ----------
  resultadoContenido.classList.remove('hidden');
  resultadoContenido.classList.add('aparecer');
  seccionResultados.classList.remove('hidden');
  seccionResultados.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Tabla con los comparables analizados y su factor de ajuste. */
function renderizarTablaComparables(comparables) {
  const tbody = document.getElementById('tabla-comparables-body');
  tbody.replaceChildren();

  if (comparables.length === 0) {
    const fila = document.createElement('tr');
    const celda = crearCelda('Sin comparables informados por el modelo.', 'px-4 py-4 text-center text-slate-400');
    celda.colSpan = 6;
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }

  comparables.forEach((comparable) => {
    const fila = document.createElement('tr');
    const superficie = aNumero(comparable.superficieM2);
    const factor = aNumero(comparable.factorAjuste);

    fila.appendChild(crearCelda(comparable.referencia || '—', 'whitespace-nowrap px-4 py-2 font-medium text-white'));
    fila.appendChild(crearCelda(comparable.comuna || '—', 'px-4 py-2 text-slate-300'));
    fila.appendChild(crearCelda(
      superficie === null ? '—' : `${fmtDecimal.format(superficie)} m²`,
      'px-4 py-2 text-right tabular-nums text-slate-200'
    ));
    fila.appendChild(crearCelda(formatearCLP(comparable.valorM2), 'px-4 py-2 text-right tabular-nums text-slate-200'));
    fila.appendChild(crearCelda(
      factor === null ? '—' : fmtFactor.format(factor),
      'px-4 py-2 text-center font-bold tabular-nums text-blue-300'
    ));
    fila.appendChild(crearCelda(comparable.justificacion || '—', 'px-4 py-2 text-slate-300'));

    tbody.appendChild(fila);
  });
}

/** Factores de ajuste aplicados por el modelo. */
function renderizarFactores(factores) {
  const lista = document.getElementById('lista-factores');
  lista.replaceChildren();

  if (factores.length === 0) {
    const item = document.createElement('li');
    item.className = 'text-slate-400';
    item.textContent = 'El modelo no detalló factores de ajuste.';
    lista.appendChild(item);
    return;
  }

  factores.forEach((factor) => {
    const item = document.createElement('li');
    item.className =
      'flex flex-col gap-0.5 rounded-lg bg-slate-900/40 px-3 py-2 ring-1 ring-slate-700 md:flex-row md:items-center md:justify-between';

    const nombre = document.createElement('span');
    nombre.className = 'font-semibold text-white';
    nombre.textContent = factor.factor || 'Factor';

    const valor = aNumero(factor.valor);
    const monto = document.createElement('span');
    monto.className = 'font-bold tabular-nums text-blue-300';
    monto.textContent = valor === null ? '—' : fmtFactor.format(valor);

    const justificacion = document.createElement('span');
    justificacion.className = 'text-xs text-slate-400 md:ml-4 md:text-right';
    justificacion.textContent = factor.justificacion || '';

    item.append(nombre, monto, justificacion);
    lista.appendChild(item);
  });
}

/** Advertencias del análisis en caja de fondo amarillo claro. */
function renderizarAdvertencias(advertencias) {
  const caja = document.getElementById('advertencias');
  const lista = document.getElementById('lista-advertencias');
  lista.replaceChildren();

  const validas = advertencias.filter(
    (advertencia) => typeof advertencia === 'string' && advertencia.trim().length > 0
  );

  if (validas.length === 0) {
    caja.classList.add('hidden');
    return;
  }

  validas.forEach((advertencia) => {
    const item = document.createElement('li');
    item.className = 'text-amber-900'; // texto oscuro sobre el ámbar claro de la caja
    item.textContent = advertencia.trim();
    lista.appendChild(item);
  });

  caja.classList.remove('hidden');
}

/* =========================================================
   Descarga del informe (POST /api/exportar/pdf y /api/exportar/excel)
   ========================================================= */

/** Cuerpo que esperan los endpoints de exportación. */
function construirCuerpoExportacion() {
  if (!ultimaTasacion) return null;

  return {
    datos: ultimaTasacion.datos,
    resultado: ultimaTasacion.resultado,
    meta: ultimaTasacion.meta
  };
}

/** Lee el nombre del archivo desde la cabecera Content-Disposition. */
function obtenerNombreArchivo(respuesta, nombrePorDefecto) {
  const cabecera = respuesta.headers.get('Content-Disposition') || '';

  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecera);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch (error) {
      // Si no se puede decodificar se intenta con el nombre simple
    }
  }

  const simple = /filename="?([^";]+)"?/i.exec(cabecera);
  return simple ? simple[1].trim() : nombrePorDefecto;
}

/** Fuerza la descarga de un Blob mediante un enlace temporal. */
function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');

  enlace.href = url;
  enlace.download = nombre;
  enlace.rel = 'noopener';

  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();

  // El objeto URL se libera cuando el navegador ya tomó el archivo
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Solicita el archivo al backend y lo descarga.
 * @param {string} endpoint Ruta de exportación.
 * @param {HTMLButtonElement} boton Botón que disparó la acción.
 * @param {string} descripcion Texto para los mensajes ("PDF", "Excel").
 * @param {string} nombrePorDefecto Nombre de archivo si el backend no lo envía.
 */
async function descargarExportacion(endpoint, boton, descripcion, nombrePorDefecto) {
  const cuerpo = construirCuerpoExportacion();

  if (!cuerpo) {
    alert('Primero genera una tasación para poder descargar el informe.');
    return;
  }

  const contenidoOriginal = boton.innerHTML;

  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    const respuesta = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });

    // Si hubo un error el backend responde JSON, no el archivo
    if (!respuesta.ok) {
      const fallo = await respuesta.json().catch(() => null);
      const detalles = fallo && fallo.error && Array.isArray(fallo.error.detalles)
        ? `\n\n${fallo.error.detalles.join('\n')}`
        : '';
      const mensaje = (fallo && fallo.error && fallo.error.mensaje) || `Error HTTP ${respuesta.status}`;

      throw new Error(`${mensaje}${detalles}`);
    }

    const blob = await respuesta.blob();
    descargarBlob(blob, obtenerNombreArchivo(respuesta, nombrePorDefecto));
  } catch (error) {
    const mensaje = (error && error.message) || 'No fue posible completar la descarga.';
    alert(`No fue posible generar el archivo ${descripcion}:\n\n${mensaje}`);
  } finally {
    boton.disabled = false;
    boton.innerHTML = contenidoOriginal;
  }
}

/**
 * Vuelve al formulario para generar una nueva tasación.
 * Descarta el resultado mostrado (y la copia usada por las descargas).
 */
function reiniciarTasacion() {
  ultimaTasacion = null;

  errorPeticion.classList.add('hidden');
  resultadoContenido.classList.add('hidden');
  seccionResultados.classList.add('hidden');

  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =========================================================
   Historial de tasaciones (GET /api/tasaciones)
   ========================================================= */

/** Formatea la fecha ISO (UTC) guardada en SQLite a hora local legible. */
function formatearFecha(valor) {
  if (!valor) return '—';

  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);

  return fmtFecha.format(fecha);
}

/** Muestra u oculta el spinner interno de la sección del historial. */
function mostrarCargandoHistorial(visible) {
  historialCargando.classList.toggle('hidden', !visible);
  historialCargando.classList.toggle('flex', visible);
}

/** Muestra el mensaje de error del historial (vacío para limpiarlo). */
function mostrarErrorHistorial(mensaje) {
  if (!mensaje) {
    historialError.textContent = '';
    historialError.classList.add('hidden');
    return;
  }

  historialError.textContent = mensaje;
  historialError.classList.remove('hidden');
}

/** Dibuja las filas del historial (DOM seguro, sin innerHTML). */
function renderizarHistorial(tasaciones) {
  historialBody.replaceChildren();

  historialContador.textContent =
    tasaciones.length === 0
      ? 'Sin registros'
      : `${tasaciones.length} ${tasaciones.length === 1 ? 'tasación guardada' : 'tasaciones guardadas'}`;

  if (tasaciones.length === 0) {
    historialTablaWrapper.classList.add('hidden');
    historialVacio.classList.remove('hidden');
    return;
  }

  historialVacio.classList.add('hidden');
  historialTablaWrapper.classList.remove('hidden');

  tasaciones.forEach((tasacion) => {
    const fila = document.createElement('tr');
    fila.className = 'hover:bg-slate-50';
    const superficie = aNumero(tasacion.superficie);

    fila.appendChild(crearCelda(
      formatearFecha(tasacion.fecha),
      'whitespace-nowrap px-4 py-2 text-slate-600'
    ));
    fila.appendChild(crearCelda(tasacion.comuna || '—', 'px-4 py-2 font-medium text-slate-800'));
    fila.appendChild(crearCelda(tasacion.tipo || '—', 'px-4 py-2 capitalize text-slate-600'));
    fila.appendChild(crearCelda(
      superficie === null ? '—' : `${fmtDecimal.format(superficie)} m²`,
      'px-4 py-2 text-right tabular-nums'
    ));
    fila.appendChild(crearCelda(
      formatearCLP(tasacion.valorReferencia),
      'px-4 py-2 text-right font-semibold tabular-nums text-blue-900'
    ));

    historialBody.appendChild(fila);
  });
}

/** Pide el historial a la API y lo renderiza en la tabla. */
async function cargarHistorial() {
  mostrarErrorHistorial('');
  historialVacio.classList.add('hidden');
  historialTablaWrapper.classList.add('hidden');
  historialContador.textContent = 'Cargando…';
  mostrarCargandoHistorial(true);

  try {
    const respuesta = await fetch(`${ENDPOINT_HISTORIAL}?limite=${LIMITE_HISTORIAL}`);
    const cuerpo = await respuesta.json().catch(() => null);

    if (!respuesta.ok || !cuerpo || cuerpo.ok !== true) {
      const mensaje = (cuerpo && cuerpo.error && cuerpo.error.mensaje) || `Error HTTP ${respuesta.status}`;
      throw new Error(mensaje);
    }

    renderizarHistorial(Array.isArray(cuerpo.data) ? cuerpo.data : []);
  } catch (error) {
    historialContador.textContent = 'Error al cargar';
    mostrarErrorHistorial(
      (error && error.message) || 'No fue posible cargar el historial de tasaciones.'
    );
  } finally {
    mostrarCargandoHistorial(false);
  }
}

/** Abre/cierra la sección del historial y refresca sus datos al abrirse. */
function alternarHistorial() {
  const estaOculto = seccionHistorial.classList.contains('hidden');

  if (estaOculto) {
    seccionHistorial.classList.remove('hidden');
    btnHistorial.setAttribute('aria-expanded', 'true');
    seccionHistorial.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cargarHistorial();
    return;
  }

  seccionHistorial.classList.add('hidden');
  btnHistorial.setAttribute('aria-expanded', 'false');
}

/* =========================================================
   Inicialización
   ========================================================= */

form.addEventListener('submit', enviarTasacion);
btnAgregar.addEventListener('click', crearComparable);
btnHistorial.addEventListener('click', alternarHistorial);
btnActualizarHistorial.addEventListener('click', cargarHistorial);
btnCerrarHistorial.addEventListener('click', alternarHistorial);

// Descarga del informe en PDF / Excel (solo si los botones existen en la vista)
if (btnDescargarPDF && btnDescargarExcel) {
  btnDescargarPDF.addEventListener('click', () =>
    descargarExportacion(ENDPOINT_EXPORT_PDF, btnDescargarPDF, 'PDF', 'tasacion.pdf')
  );
  btnDescargarExcel.addEventListener('click', () =>
    descargarExportacion(ENDPOINT_EXPORT_EXCEL, btnDescargarExcel, 'Excel', 'tasacion.xlsx')
  );
}

if (btnNuevaTasacion) {
  btnNuevaTasacion.addEventListener('click', reiniciarTasacion);
}

// Se parte con el mínimo de comparables exigido por el backend
for (let i = 0; i < MIN_COMPARABLES; i += 1) {
  crearComparable();
}
actualizarContador();



