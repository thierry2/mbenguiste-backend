const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const schemas = require('../validations/discovery.validation');
const c = require('../controllers/discovery.controller');

const router = express.Router();

// File de profils à découvrir.
router.get('/candidates', authenticate, c.getCandidates);
// Swiper un profil : POST /discovery/:id/swipe { action }.
router.post('/:id/swipe', authenticate, validate(schemas.swipe), c.swipe);

module.exports = router;
