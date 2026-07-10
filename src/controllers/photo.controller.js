const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const photoModel = require('../models/photo.model');
const { uploadProfilePhoto } = require('../services/upload.service');

/** POST /profiles/me/photos — ajoute une photo de profil (multipart, champ `file`). */
const addPhoto = catchAsync(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Aucun fichier reçu');
  const { url } = await uploadProfilePhoto(req.file, req.user.id);
  const photos = await photoModel.add(req.user.id, url);
  res.status(201).json({ success: true, data: { photos } });
});

/** DELETE /profiles/me/photos/:photoId */
const deletePhoto = catchAsync(async (req, res) => {
  const photos = await photoModel.remove(req.user.id, req.params.photoId);
  res.json({ success: true, data: { photos } });
});

module.exports = { addPhoto, deletePhoto };
