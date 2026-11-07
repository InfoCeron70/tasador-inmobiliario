'use strict';

const { Router } = require('express');
const { crearTasacion } = require('../controllers/tasacion.controller');

const router = Router();

// Endpoint de tasacion: recibe los datos de la propiedad y devuelve la estimacion
router.post('/api/tasacion', crearTasacion);

module.exports = router;
