const catchAsync = require('../utils/catchAsync');
const profileModel = require('../models/profile.model');
const supabase = require('../config/supabase');

/**
 * Vérifie si un e-mail est déjà rattaché à un profil (public, rate-limité).
 * Permet à l'inscription d'afficher « déjà utilisé » AVANT le signUp Supabase.
 */
const checkEmail = catchAsync(async (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.json({ success: true, data: { exists: false } });
  const { data, error } = await supabase
    .from('profiles').select('id').eq('email', email).maybeSingle();
  if (error) throw error;
  res.json({ success: true, data: { exists: !!data } });
});

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

module.exports = { ensureProfile, checkEmail };
