'use strict';

const { Router } = require('express');
const { crearTasacion, obtenerHistorial } = require('../controllers/tasacion.controller');

const router = Router();

// Endpoint de tasacion: recibe los datos de la propiedad y devuelve la estimacion
router.post('/api/tasacion', crearTasacion);

// Historial de tasaciones guardadas (de la mas reciente a la mas antigua)
router.get('/api/tasaciones', obtenerHistorial);

module.exports = router;
