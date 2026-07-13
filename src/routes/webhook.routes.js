const express = require('express');
const c = require('../controllers/webhook.controller');

const router = express.Router();

// Pas d'authenticate : appel serveur-à-serveur de RevenueCat, protégé par l'en-tête
// Authorization partagé (cf. webhook.controller). URL à déclarer côté RC :
//   https://<railway>/api/v1/webhooks/revenuecat
router.post('/revenuecat', c.revenuecat);

module.exports = router;
