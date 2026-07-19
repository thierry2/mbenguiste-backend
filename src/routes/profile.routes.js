const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { memoryUpload } = require('../middlewares/upload.middleware');
const schemas = require('../validations/profile.validation');
const c = require('../controllers/profile.controller');
const photoC = require('../controllers/photo.controller');
const modC = require('../controllers/moderation.controller');

const router = express.Router();

router.get('/me', authenticate, c.getMe);
router.patch('/me', authenticate, validate(schemas.updateMe), c.updateMe);
router.post('/me/onboarding', authenticate, validate(schemas.completeOnboarding), c.completeOnboarding);

// Programme Partenaires : valider un code (live) + le rattacher (cadeau de bienvenue).
// Limité : sans ça, un compte authentifié pourrait ÉNUMÉRER les codes valides en
// les essayant en rafale (et découvrir qui sont les partenaires).
const referralLimiter = require('express-rate-limit')({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop d\'essais de code. Réessaie dans quelques minutes.' },
});
router.get('/me/referral/lookup', authenticate, referralLimiter, c.lookupReferral);
router.post('/me/referral', authenticate, referralLimiter, validate(schemas.redeemReferral), c.redeemReferral);
router.get('/me/preferences', authenticate, c.getPreferences);
router.put('/me/preferences', authenticate, validate(schemas.preferences), c.setPreferences);
router.get('/me/entitlements', authenticate, c.getEntitlements);
router.patch('/me/location', authenticate, validate(schemas.location), c.updateLocation);
router.post('/me/push-token', authenticate, c.savePushToken);
router.patch('/me/settings', authenticate, c.updateSettings);
router.delete('/me', authenticate, c.deleteMe);
router.post('/me/cancel-deletion', authenticate, c.cancelDeleteMe);

// Modération (store-required) : bloquer / débloquer / signaler.
router.get('/me/blocks', authenticate, modC.listBlocked);
router.post('/:id/block', authenticate, modC.blockUser);
router.delete('/:id/block', authenticate, modC.unblockUser);
router.post('/:id/report', authenticate, validate(schemas.report), modC.reportUser);

// Centre de sécurité : signaler même une personne disparue des matchs.
router.get('/me/past-connections', authenticate, modC.pastConnections);
router.post('/reports/freeform', authenticate, validate(schemas.freeformReport), modC.reportFreeform);

// Photos de profil (multipart, champ `file`).
router.post('/me/photos', authenticate, memoryUpload.single('file'), photoC.addPhoto);
router.delete('/me/photos/:photoId', authenticate, photoC.deletePhoto);

// Profil public d'un autre membre (après match ou dans la découverte).
router.get('/:id', authenticate, c.getById);

module.exports = router;
