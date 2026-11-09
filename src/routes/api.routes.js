'use strict';

const { Router } = require('express');
const { crearTasacion, obtenerHistorial } = require('../controllers/tasacion.controller');
const { exportarExcel, exportarPDF } = require('../controllers/export.controller');

const router = Router();

// Endpoint de tasacion: recibe los datos de la propiedad y devuelve la estimacion
router.post('/api/tasacion', crearTasacion);

// Historial de tasaciones guardadas (de la mas reciente a la mas antigua)
router.get('/api/tasaciones', obtenerHistorial);

// Exportacion del resultado: el archivo se genera en memoria y se descarga
router.post('/api/exportar/excel', exportarExcel);
router.post('/api/exportar/pdf', exportarPDF);

module.exports = router;
