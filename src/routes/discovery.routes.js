const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const schemas = require('../validations/discovery.validation');
const c = require('../controllers/discovery.controller');

const router = express.Router();

// File de profils à découvrir.
router.get('/candidates', authenticate, c.getCandidates);
// Aperçu live du nombre de profils pour des préférences données (non enregistrées).
router.post('/count', authenticate, validate(schemas.previewCount), c.countCandidates);
// Activer un Boost (dépense 1 crédit).
router.post('/boost', authenticate, c.boost);
// Rewind : annuler le dernier swipe (Plus+ — 402 sinon).
router.post('/rewind', authenticate, c.rewind);
// Coups de cœur du jour : la sélection est visible par tout le monde…
router.get('/picks', authenticate, c.dailyPicks);
// …c'est l'ACTION qui se paie : 1 like gratuit/jour, au-delà = Or (402 picks_like).
router.post('/picks/:id/like', authenticate, validate(schemas.pickLike), c.likePick);
// « Qui t'a liké » — total toujours, profils réservés à l'Or.
router.get('/likes', authenticate, c.likesReceived);
// Swiper un profil : POST /discovery/:id/swipe { action }.
router.post('/:id/swipe', authenticate, validate(schemas.swipe), c.swipe);

module.exports = router;
