const multer = require('multer');
const { MAX_UPLOAD_SIZE } = require('../services/upload.service');
const { MAX_INPUT_SIZE: MAX_VIDEO_SIZE } = require('../services/videoCompression.service');

// Fichiers en mémoire (buffer), jamais sur disque. Garde-fou dur de taille ;
// le filtrage précis par type se fait dans le service d'upload.
// Un dépassement lève une MulterError, traduite en 400 par le gestionnaire d'erreurs.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

// Upload VIDÉO (console admin, workflow de graphe) : limite bien plus haute, car
// on reçoit la vidéo AVANT compression. Le type précis est validé dans le service.
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_SIZE },
});

module.exports = { memoryUpload, videoUpload };
