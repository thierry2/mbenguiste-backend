const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const c = require('../controllers/reference.controller');

const router = express.Router();

// Listes de référence (onboarding, filtres). Auth requise mais lecture seule.
router.get('/bootstrap', authenticate, c.bootstrap);

module.exports = router;
