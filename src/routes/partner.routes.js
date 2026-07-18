const express = require('express');
const { authenticate, requirePartner } = require('../middlewares/auth.middleware');
const c = require('../controllers/partner.controller');

const router = express.Router();

// Portail partenaire : jeton Supabase (authenticate) + compte partenaire (requirePartner).
router.use(authenticate, requirePartner);

router.get('/me', c.me);
router.get('/stats', c.getStats);
router.get('/referrals', c.getReferrals);
router.get('/payouts', c.getPayouts);

module.exports = router;
