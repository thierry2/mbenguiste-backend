const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/auth.middleware');
const { ensureProfile, checkEmail } = require('../controllers/auth.controller');

const router = express.Router();

// Limite l'énumération d'e-mails (le check est public par nature).
const checkLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Vérifie la disponibilité d'un e-mail avant le signUp (public).
router.get('/check-email', checkLimiter, checkEmail);

// Crée/renvoie le profil à la 1re connexion (Supabase Auth a déjà créé le compte).
router.post('/ensure-profile', authenticate, ensureProfile);

module.exports = router;
