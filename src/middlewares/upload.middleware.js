const multer = require('multer');
const { MAX_UPLOAD_SIZE } = require('../services/upload.service');

// Fichiers en mémoire (buffer), jamais sur disque. Garde-fou dur de taille ;
// le filtrage précis par type se fait dans le service d'upload.
// Un dépassement lève une MulterError, traduite en 400 par le gestionnaire d'erreurs.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

module.exports = { memoryUpload };
