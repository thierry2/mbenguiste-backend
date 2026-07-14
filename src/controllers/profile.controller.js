const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const config = require('../config');
const profileModel = require('../models/profile.model');
const profileService = require('../services/profile.service');
const entitlementsService = require('../services/entitlements.service');

const getMe = catchAsync(async (req, res) => {
  profileModel.touchActivity(req.user.id).catch(() => {}); // présence, non bloquant
  const profile = await profileModel.findById(req.user.id);
  if (!profile) throw ApiError.notFound('Profil introuvable');
  res.json({ success: true, data: { profile } });
});

const updateMe = catchAsync(async (req, res) => {
  const profile = await profileService.updateProfile(req.user.id, req.body);
  res.json({ success: true, data: { profile } });
});

/** Termine l'onboarding : dernières infos + bascule onboarding_done à true. */
const completeOnboarding = catchAsync(async (req, res) => {
  const profile = await profileService.updateProfile(req.user.id, {
    ...req.body,
    onboardingFait: true,
  });
  res.json({ success: true, data: { profile } });
});

const getById = catchAsync(async (req, res) => {
  const profile = await profileModel.findById(req.params.id);
  if (!profile) throw ApiError.notFound('Profil introuvable');

  // Verrou de réciprocité photos (réf Tinder) : sans N photos soi-même, on ne
  // voit QUE la 1re photo des autres. Appliqué serveur (incontournable) et à
  // tout le monde, Or compris. Le front affiche le bloc « Débloquer les photos ».
  if (req.params.id !== req.user.id) {
    profile.photosTotal = profile.photos.length;
    const mine = await profileModel.photoCount(req.user.id);
    if (mine < config.limits.photosRequiredToView) {
      profile.photos = profile.photos.slice(0, 1);
      profile.photosVerrouillees = true;
    } else {
      profile.photosVerrouillees = false;
    }
  }

  res.json({ success: true, data: { profile } });
});

const getPreferences = catchAsync(async (req, res) => {
  const preferences = await profileService.getPreferences(req.user.id);
  res.json({ success: true, data: { preferences } });
});

const setPreferences = catchAsync(async (req, res) => {
  const preferences = await profileService.setPreferences(req.user.id, req.body);
  res.json({ success: true, data: { preferences } });
});

/** Droits & compteurs (premium, crédits, quotas restants) — source du gating front. */
const getEntitlements = catchAsync(async (req, res) => {
  const entitlements = await entitlementsService.forUser(req.user.id);
  res.json({ success: true, data: { entitlements } });
});

const savePushToken = catchAsync(async (req, res) => {
  const { pushToken } = req.body;
  if (!pushToken) throw ApiError.badRequest('pushToken requis');
  const supabase = require('../config/supabase');
  await supabase.from('profiles').update({ push_token: pushToken }).eq('id', req.user.id);
  res.json({ success: true });
});

/** Réglages (notifications + visibilité). Corps = booléens optionnels. */
const updateSettings = catchAsync(async (req, res) => {
  const profile = await profileModel.updateSettings(req.user.id, req.body || {});
  res.json({ success: true, data: { profile } });
});

/** Suppression du compte (soft delete + anonymisation). Le client se déconnecte ensuite. */
const deleteMe = catchAsync(async (req, res) => {
  await profileModel.softDelete(req.user.id);
  res.json({ success: true });
});

/** Enregistre la position de l'utilisateur (expo-location). */
const updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = req.body;
  await profileModel.setLocation(req.user.id, lat, lng);
  res.json({ success: true });
});

module.exports = { getMe, updateMe, completeOnboarding, getById, getPreferences, setPreferences, getEntitlements, updateLocation, savePushToken, updateSettings, deleteMe };
