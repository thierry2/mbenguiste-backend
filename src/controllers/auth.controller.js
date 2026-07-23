const catchAsync = require('../utils/catchAsync');
const profileModel = require('../models/profile.model');
const supabase = require('../config/supabase');

/**
 * Vérifie si un e-mail est déjà rattaché à un COMPTE (public, rate-limité).
 * Permet à l'inscription d'afficher « déjà utilisé » AVANT le signUp Supabase.
 *
 * Interroge auth.users (via le RPC `email_exists`, migration 039), PAS
 * profiles : un compte peut exister côté auth sans ligne profiles encore créée
 * (app fermée avant le premier /auth/ensure-profile) — le check répondait alors
 * « disponible » à tort, et le signUp échouait juste après.
 */
const checkEmail = catchAsync(async (req, res) => {
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.json({ success: true, data: { exists: false } });
  const { data, error } = await supabase.rpc('email_exists', { p_email: email });
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
