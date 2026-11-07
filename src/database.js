'use strict';

/**
 * Acceso a datos del historial de tasaciones (SQLite).
 *
 * Se usa una unica base de datos local (tasaciones.db) con una tabla
 * "historial" en la que cada fila resume la tasacion (comuna, tipo,
 * superficie, valor de referencia) y guarda la respuesta completa de
 * DeepSeek serializada como JSON en la columna datos_json.
 *
 * La conexion se abre de forma perezosa (lazy) la primera vez que se
 * necesita, de modo que el arranque del servidor no falla si algo va mal
 * con el archivo de base de datos.
 */

const path = require('path');
const sqlite3 = require('sqlite3');

// Ruta del archivo de base de datos (se puede sobreescribir con DB_PATH)
const RUTA_BASE_DATOS = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'tasaciones.db');

// Limites del listado del historial
const LIMITE_DEFECTO = 100;
const LIMITE_MAXIMO = 500;

let conexion = null;
let promesaInicializacion = null;

/**
 * DDL de la tabla del historial.
 * La fecha se guarda en ISO 8601 UTC (strftime) para poder formatearla
 * en la zona horaria del navegador sin ambiguedades.
 */
const SQL_TABLA_HISTORIAL = `
  CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    comuna TEXT NOT NULL,
    tipo TEXT NOT NULL,
    superficie REAL NOT NULL,
    valor_referencia REAL,
    datos_json TEXT NOT NULL
  );
`;

const SQL_INDICE_FECHA =
  'CREATE INDEX IF NOT EXISTS idx_historial_fecha ON historial (fecha DESC, id DESC);';

/** Abre la conexion con el archivo SQLite. */
function abrirConexion() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(RUTA_BASE_DATOS, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

/**
 * Ejecuta una sentencia que modifica datos (INSERT/UPDATE/DDL).
 * @returns {Promise<{ id: number, cambios: number }>}
 */
function ejecutar(db, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, parametros, function alTerminar(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ id: this.lastID, cambios: this.changes });
    });
  });
}

/**
 * Ejecuta una consulta de lectura y devuelve todas las filas.
 * @returns {Promise<object[]>}
 */
function consultar(db, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, parametros, (error, filas) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(filas || []);
    });
  });
}

/** Parsea el JSON guardado; devuelve null si el contenido no es valido. */
function parsearJSON(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') return null;

  try {
    return JSON.parse(texto);
  } catch (error) {
    return null;
  }
}

/**
 * Convierte una fila de SQLite al formato que consume el frontend.
 * @param {object} fila
 */
function mapearFila(fila) {
  return {
    id: fila.id,
    fecha: fila.fecha,
    comuna: fila.comuna,
    tipo: fila.tipo,
    superficie: fila.superficie,
    valorReferencia: fila.valor_referencia,
    datos: parsearJSON(fila.datos_json)
  };
}

/**
 * Abre la conexion y garantiza que exista la tabla del historial.
 * Es idempotente: las llamadas posteriores reutilizan la misma conexion.
 * @returns {Promise<sqlite3.Database>}
 */
async function inicializar() {
  if (conexion) return conexion;

  if (!promesaInicializacion) {
    promesaInicializacion = (async () => {
      const db = await abrirConexion();
      await ejecutar(db, SQL_TABLA_HISTORIAL);
      await ejecutar(db, SQL_INDICE_FECHA);
      conexion = db;
      console.log(`[database] SQLite lista en ${RUTA_BASE_DATOS}`);
      return conexion;
    })().catch((error) => {
      // Permite reintentar la inicializacion en la siguiente peticion
      promesaInicializacion = null;
      throw error;
    });
  }

  return promesaInicializacion;
}

/**
 * Guarda una tasacion en el historial.
 * @param {object} registro
 * @param {string} registro.comuna
 * @param {string} registro.tipo
 * @param {number} registro.superficie
 * @param {number|null} [registro.valorReferencia]
 * @param {object|null} [registro.datos] Respuesta completa de DeepSeek.
 * @returns {Promise<{ id: number }>}
 */
async function guardarTasacion(registro) {
  const db = await inicializar();
  const {
    comuna,
    tipo,
    superficie,
    valorReferencia = null,
    datos = null
  } = registro || {};

  const { id } = await ejecutar(
    db,
    `INSERT INTO historial (comuna, tipo, superficie, valor_referencia, datos_json)
     VALUES (?, ?, ?, ?, ?)`,
    [comuna, tipo, superficie, valorReferencia, JSON.stringify(datos)]
  );

  return { id };
}

/**
 * Devuelve el historial de tasaciones, desde la mas reciente a la mas antigua.
 * @param {object} [opciones]
 * @param {number} [opciones.limite] Cantidad maxima de registros (1-500).
 * @returns {Promise<object[]>}
 */
async function listarTasaciones(opciones = {}) {
  const db = await inicializar();
  const solicitado = Number(opciones.limite);
  const limite =
    Number.isFinite(solicitado) && solicitado > 0
      ? Math.min(Math.trunc(solicitado), LIMITE_MAXIMO)
      : LIMITE_DEFECTO;

  const filas = await consultar(
    db,
    `SELECT id, fecha, comuna, tipo, superficie, valor_referencia, datos_json
       FROM historial
      ORDER BY fecha DESC, id DESC
      LIMIT ?`,
    [limite]
  );

  return filas.map(mapearFila);
}

/** Cierra la conexion (util para scripts de prueba y apagados limpios). */
function cerrarBaseDeDatos() {
  return new Promise((resolve) => {
    if (!conexion) {
      resolve();
      return;
    }

    conexion.close(() => {
      conexion = null;
      promesaInicializacion = null;
      resolve();
    });
  });
}

module.exports = {
  inicializar,
  guardarTasacion,
  listarTasaciones,
  cerrarBaseDeDatos,
  RUTA_BASE_DATOS,
  LIMITE_DEFECTO,
  LIMITE_MAXIMO
};
