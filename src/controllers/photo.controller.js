const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const photoModel = require('../models/photo.model');
const logger = require('../utils/logger');
const { uploadProfilePhoto } = require('../services/upload.service');
const { makeMaskedUrl } = require('../services/mask.service');

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

  const photos = await photoModel.add(req.user.id, url, blurUrl);
  res.status(201).json({ success: true, data: { photos } });
});

/** DELETE /profiles/me/photos/:photoId */
const deletePhoto = catchAsync(async (req, res) => {
  const photos = await photoModel.remove(req.user.id, req.params.photoId);
  res.json({ success: true, data: { photos } });
});

module.exports = { addPhoto, deletePhoto };
