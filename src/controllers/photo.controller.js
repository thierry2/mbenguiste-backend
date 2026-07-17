const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const photoModel = require('../models/photo.model');
const logger = require('../utils/logger');
const { uploadProfilePhoto } = require('../services/upload.service');
const { makeMaskedUrl } = require('../services/mask.service');
const embedding = require('../services/embedding.service');
const { toSqlVector } = require('../domain/similarity');

/** La signature visuelle du profil (photo_vec) — best-effort, jamais bloquant. */
async function refreshPhotoVec(userId) {
  try {
    await embedding.refreshProfileVec(userId);
  } catch (err) {
    logger.error?.(`photo_vec non recalculé (${userId}) : ${err.message}`);
  }
}

/** POST /profiles/me/photos — ajoute une photo de profil (multipart, champ `file`). */
const addPhoto = catchAsync(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Aucun fichier reçu');
  const { url } = await uploadProfilePhoto(req.file, req.user.id);

  // Version floutée pour les contextes masqués — best-effort : si ça échoue, la
  // photo est quand même ajoutée (blur_url null → placeholder côté app), et le
  // backfill pourra rattraper plus tard.
  let blurUrl = null;
  try {
    blurUrl = await makeMaskedUrl(url);
  } catch (err) {
    logger.error?.(`Flou photo échoué (${req.user.id}) : ${err.message}`);
  }

  // Empreinte visuelle (similarité, cahier §2) — même doctrine best-effort :
  // générée depuis le buffer déjà en main (pas de re-téléchargement).
  let vec = null;
  try {
    vec = toSqlVector(await embedding.embedImage(req.file.buffer));
  } catch (err) {
    logger.error?.(`Embedding photo échoué (${req.user.id}) : ${err.message}`);
  }

  const photos = await photoModel.add(req.user.id, url, blurUrl, vec);
  await refreshPhotoVec(req.user.id);
  res.status(201).json({ success: true, data: { photos } });
});

/** DELETE /profiles/me/photos/:photoId */
const deletePhoto = catchAsync(async (req, res) => {
  const photos = await photoModel.remove(req.user.id, req.params.photoId);
  await refreshPhotoVec(req.user.id);
  res.json({ success: true, data: { photos } });
});

module.exports = { addPhoto, deletePhoto };
