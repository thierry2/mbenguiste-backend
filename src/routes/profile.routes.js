const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { memoryUpload } = require('../middlewares/upload.middleware');
const schemas = require('../validations/profile.validation');
const c = require('../controllers/profile.controller');
const photoC = require('../controllers/photo.controller');

const router = express.Router();

router.get('/me', authenticate, c.getMe);
router.patch('/me', authenticate, validate(schemas.updateMe), c.updateMe);
router.post('/me/onboarding', authenticate, validate(schemas.completeOnboarding), c.completeOnboarding);
router.get('/me/preferences', authenticate, c.getPreferences);
router.put('/me/preferences', authenticate, validate(schemas.preferences), c.setPreferences);
router.post('/me/push-token', authenticate, c.savePushToken);

// Photos de profil (multipart, champ `file`).
router.post('/me/photos', authenticate, memoryUpload.single('file'), photoC.addPhoto);
router.delete('/me/photos/:photoId', authenticate, photoC.deletePhoto);

// Profil public d'un autre membre (après match ou dans la découverte).
router.get('/:id', authenticate, c.getById);

module.exports = router;
