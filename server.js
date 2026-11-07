'use strict';

// Carga las variables de entorno ANTES de requerir modulos que las consuman
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const apiRoutes = require('./src/routes/api.routes');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------- Middlewares globales ----------
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- Archivos estaticos (frontend) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Rutas de la API ----------
app.use(apiRoutes);

// ---------- 404 para cualquier recurso no encontrado ----------
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: {
      codigo: 'NOT_FOUND',
      mensaje: `Recurso no encontrado: ${req.method} ${req.originalUrl}`
    }
  });
});

// ---------- Manejador de errores central ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Error no controlado:', err);

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      ok: false,
      error: {
        codigo: 'JSON_INVALIDO',
        mensaje: 'El cuerpo de la peticion no es un JSON valido.'
      }
    });
  }

  res.status(err.status || 500).json({
    ok: false,
    error: {
      codigo: err.codigo || 'ERROR_INTERNO',
      mensaje: err.mensaje || 'Ocurrio un error inesperado en el servidor.'
    }
  });
});

// ---------- Arranque ----------
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`Modelo DeepSeek configurado: ${process.env.DEEPSEEK_MODEL || 'deepseek-flash'}`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('[server] ADVERTENCIA: DEEPSEEK_API_KEY no esta definida. POST /api/tasacion devolvera 500 CONFIG_ERROR.');
  }
});

module.exports = app;
