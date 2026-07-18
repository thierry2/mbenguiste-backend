const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const config = require('../config');
const profileModel = require('../models/profile.model');
const profileService = require('../services/profile.service');
const entitlementsService = require('../services/entitlements.service');
const safetyService = require('../services/safety.service');

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
  // Garde de blocage AVANT tout : la découverte excluait déjà les bloqués et la
  // conversation était close, mais cette route servait encore la fiche à qui
  // avait gardé l'identifiant. 404 et non 403 — un 403 confirmerait le compte.
  if (await safetyService.profileHiddenFor(req.user.id, req.params.id)) {
    throw ApiError.notFound('Profil introuvable');
  }

  const profile = await profileModel.findById(req.params.id);
  if (!profile) throw ApiError.notFound('Profil introuvable');

  // Verrou de réciprocité photos (réf Tinder) : sans N photos soi-même, on ne
  // voit que les 2 PREMIÈRES photos des autres (aligné sur le deck — spec
  // 16/07). Appliqué serveur (incontournable) et à tout le monde, Or compris.
  // Le flag n'est posé que s'il y a réellement des photos cachées.
  if (req.params.id !== req.user.id) {
    const visible = config.limits.photosRequiredToView;
    profile.photosTotal = profile.photos.length;
    const mine = await profileModel.photoCount(req.user.id);
    if (mine < config.limits.photosRequiredToView && profile.photos.length > visible) {
      profile.photos = profile.photos.slice(0, visible);
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

/**
 * Programme la suppression du compte (délai de grâce). Le compte reste actif : le
 * client affiche une bannière d'annulation, il ne se déconnecte PAS. La purge
 * définitive (anonymisation) a lieu à l'expiration, côté serveur.
 */
const deleteMe = catchAsync(async (req, res) => {
  const programmationSuppression = await profileModel.scheduleDeleteAccount(req.user.id);
  res.json({ success: true, data: { programmationSuppression } });
});

/** Annule une suppression programmée tant que le délai de grâce n'est pas échu. */
const cancelDeleteMe = catchAsync(async (req, res) => {
  await profileModel.cancelDeleteAccount(req.user.id);
  res.json({ success: true });
});

/** Enregistre la position de l'utilisateur (expo-location). */
const updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = req.body;
  await profileModel.setLocation(req.user.id, lat, lng);
  res.json({ success: true });
});

module.exports = { getMe, updateMe, completeOnboarding, getById, getPreferences, setPreferences, getEntitlements, updateLocation, savePushToken, updateSettings, deleteMe, cancelDeleteMe };
