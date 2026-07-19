const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const supabase = require('../config/supabase');
const service = require('../services/verification.service');

/** Le sceau actuel + sa date, lus au plus près (source de vérité de `verified`). */
async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, is_verified, verified_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw ApiError.notFound('Profil introuvable');
  return data;
}

/** GET /profiles/me/verification — l'état complet pour l'écran mobile. */
const getStatus = catchAsync(async (req, res) => {
  const profile = await loadProfile(req.user.id);
  res.json({ success: true, data: await service.getStatus(req.user.id, profile) });
});

/**
 * POST /profiles/me/verification/start — tire la pose et ouvre la fenêtre.
 * La pose n'existe qu'à partir de cette réponse : impossible de la connaître
 * avant, donc impossible de préparer la photo.
 */
const start = catchAsync(async (req, res) => {
  const profile = await loadProfile(req.user.id);
  res.json({ success: true, data: await service.start(req.user.id, profile) });
});

/** POST /profiles/me/verification/selfie — multipart, champ `file`. */
const submitSelfie = catchAsync(async (req, res) => {
  res.json({ success: true, data: await service.submitSelfie(req.user.id, req.file) });
});

// ── Console admin ────────────────────────────────────────────────────────────

/** GET /admin/verifications — la file d'attente, selfies signés (10 min). */
const adminList = catchAsync(async (_req, res) => {
  res.json({ success: true, data: { demandes: await service.listQueue() } });
});

/**
 * GET /admin/verifications/:id/selfie — les octets du selfie.
 * `no-store` : une photo biométrique n'a rien à faire dans le cache disque du
 * navigateur d'une personne de l'équipe.
 */
const adminSelfie = catchAsync(async (req, res) => {
  const { buffer, contentType } = await service.selfieBytes(req.params.id);
  res.set('Content-Type', contentType);
  res.set('Cache-Control', 'no-store, private');
  res.send(buffer);
});

/** GET /admin/verifications/count — bandeau de la console. */
const adminCount = catchAsync(async (_req, res) => {
  res.json({ success: true, data: { enAttente: await service.pendingCount() } });
});

/** POST /admin/verifications/:id  body: { action: 'valider'|'refuser', motif? } */
const adminDecide = catchAsync(async (req, res) => {
  const { action, motif } = req.body ?? {};
  if (!['valider', 'refuser'].includes(action)) {
    throw ApiError.badRequest('Action invalide. Valeurs acceptées : valider, refuser');
  }
  const result = await service.decide(req.params.id, {
    approve: action === 'valider',
    reason: motif ?? null,
    reviewedBy: 'admin',
  });
  res.json({ success: true, data: result });
});

module.exports = { getStatus, start, submitSelfie, adminList, adminSelfie, adminCount, adminDecide };
