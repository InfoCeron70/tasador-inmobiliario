'use strict';

/* =========================================================
   Tasación Inmobiliaria IA · lógica del frontend
   Envía el formulario a POST /api/tasacion y renderiza el resultado.
   ========================================================= */

const MIN_COMPARABLES = 2;
const MAX_COMPARABLES = 5;
const ENDPOINT = '/api/tasacion';

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
    renderizarResultado(cuerpo.data || {}, cuerpo.meta || {});
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

  const valorM2Calculado = aNumero(valorM2.calculado);
  document.getElementById('valor-m2').textContent =
    valorM2Calculado === null ? '—' : `${formatearCLP(valorM2Calculado)} /m²`;

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

    fila.appendChild(crearCelda(comparable.referencia || '—', 'px-4 py-2 font-medium text-slate-800'));
    fila.appendChild(crearCelda(comparable.comuna || '—', 'px-4 py-2 text-slate-600'));
    fila.appendChild(crearCelda(
      superficie === null ? '—' : `${fmtDecimal.format(superficie)} m²`,
      'px-4 py-2 text-right tabular-nums'
    ));
    fila.appendChild(crearCelda(formatearCLP(comparable.valorM2), 'px-4 py-2 text-right tabular-nums'));
    fila.appendChild(crearCelda(
      factor === null ? '—' : fmtFactor.format(factor),
      'px-4 py-2 text-center font-bold tabular-nums text-indigo-700'
    ));
    fila.appendChild(crearCelda(comparable.justificacion || '—', 'px-4 py-2 text-slate-600'));

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
      'flex flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2 md:flex-row md:items-center md:justify-between';

    const nombre = document.createElement('span');
    nombre.className = 'font-semibold text-slate-800';
    nombre.textContent = factor.factor || 'Factor';

    const valor = aNumero(factor.valor);
    const monto = document.createElement('span');
    monto.className = 'font-bold tabular-nums text-indigo-700';
    monto.textContent = valor === null ? '—' : fmtFactor.format(valor);

    const justificacion = document.createElement('span');
    justificacion.className = 'text-xs text-slate-500 md:ml-4 md:text-right';
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
    item.textContent = advertencia.trim();
    lista.appendChild(item);
  });

  caja.classList.remove('hidden');
}

/* =========================================================
   Inicialización
   ========================================================= */

form.addEventListener('submit', enviarTasacion);
btnAgregar.addEventListener('click', crearComparable);

// Se parte con el mínimo de comparables exigido por el backend
for (let i = 0; i < MIN_COMPARABLES; i += 1) {
  crearComparable();
}
actualizarContador();



