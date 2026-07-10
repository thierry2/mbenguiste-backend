const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { ensureProfile } = require('../controllers/auth.controller');

const router = express.Router();

// Crée/renvoie le profil à la 1re connexion (Supabase Auth a déjà créé le compte).
router.post('/ensure-profile', authenticate, ensureProfile);

module.exports = router;
