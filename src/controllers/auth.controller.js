const catchAsync = require('../utils/catchAsync');
const profileModel = require('../models/profile.model');

/**
 * Crée le profil à la 1re connexion (email ou Google), s'il n'existe pas.
 * Idempotent. Renvoie le profil et si l'onboarding reste à faire.
 */
const ensureProfile = catchAsync(async (req, res) => {
  const profile = await profileModel.ensureProfile(req.user);
  res.status(201).json({
    success: true,
    data: { profile, onboardingRequis: !profile.onboardingFait },
  });
});

module.exports = { ensureProfile };
