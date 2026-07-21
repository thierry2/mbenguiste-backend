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
// Le Mystère — la personne à découvrir, TOUJOURS masquée (jamais /likes, qui
// renvoie du clair aux comptes Or).
router.get('/mystere', authenticate, c.mystere);
// Lancer / reprendre l'Aventure : verrouille la paire, crée la session, rend mon rôle.
router.post('/mystere/start', authenticate, c.startMystere);
// Soumettre ma réponse à l'étape courante (le canal temps réel). Le serveur
// tranche quand les deux ont répondu ; le message intime est refiltré ici.
router.post('/mystere/answer', authenticate, c.submitMystereAnswer);
// Jouer le Joker : dépense 1 Joker, renvoie à l'épreuve finale (402 si vide).
router.post('/mystere/joker', authenticate, c.playJokerMystere);
// La révélation : le vrai profil du partenaire, une fois l'aventure gagnée.
router.get('/mystere/reveal', authenticate, c.mystereReveal);
// Un message de négociation (désaccord répété) — échange libre, sans résolution.
router.post('/mystere/message', authenticate, c.submitMystereMessage);
// « Qui t'a liké » — total toujours, profils réservés à l'Or.
router.get('/likes', authenticate, c.likesReceived);
// Swiper un profil : POST /discovery/:id/swipe { action }.
router.post('/:id/swipe', authenticate, validate(schemas.swipe), c.swipe);

module.exports = router;
