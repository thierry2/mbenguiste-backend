const express = require('express');
const { getCities } = require('../controllers/geo.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

router.get('/cities', authenticate, getCities);

module.exports = router;
