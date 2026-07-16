const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const schemas = require('../validations/events.validation');
const c = require('../controllers/events.controller');

const router = express.Router();

// Batch de télémétrie des sondes UI (eventOutbox côté client).
router.post('/', authenticate, validate(schemas.batch), c.postEvents);

module.exports = router;
