const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const config = require('../config');
const discoveryModel = require('../models/discovery.model');
const profileModel = require('../models/profile.model');
const swipeService = require('../services/swipe.service');
const creditsModel = require('../models/credits.model');

/** File de profils à découvrir. */
const getCandidates = catchAsync(async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
  const profils = await discoveryModel.candidates(req.user.id, { limit });
  res.json({ success: true, data: { profils } });
});

/**
 * Enregistre un swipe. body: { action: 'pass'|'like'|'super_like' }.
 * Renvoie le match éventuel (like réciproque) pour déclencher l'écran « C'est réciproque ».
 */
const swipe = catchAsync(async (req, res) => {
  const { action } = req.body;
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se swiper soi-même');

  const { match } = await swipeService.applySwipe(req.user.id, targetId, action);
  res.json({ success: true, data: { match } });
});

/**
 * « Qui t'a liké ». On renvoie TOUJOURS le total (pour l'accroche), mais les
 * profils UNIQUEMENT aux membres Or — sinon un client bidouillé verrait les
 * identités sans payer. `premiumRequis` dit au front d'afficher la grille floutée.
 */
const likesReceived = catchAsync(async (req, res) => {
  const pending = await discoveryModel.likersPending(req.user.id);
  const total = pending.length;

  const premium = await profileModel.isPremium(req.user.id);
  if (!premium) {
    return res.json({ success: true, data: { total, premiumRequis: true, likes: [] } });
  }

  const cards = await discoveryModel.cardsByIds(pending.map((p) => p.id));
  const likes = pending
    .map((p) => {
      const c = cards.get(p.id);
      return c ? { ...c, coupDeCoeur: p.superLike, likeLe: p.likedAt } : null;
    })
    .filter(Boolean);
  res.json({ success: true, data: { total, premiumRequis: false, likes } });
});

/** Active un Boost (dépense 1 crédit) : mise en avant en découverte ~30 min. */
const boost = catchAsync(async (req, res) => {
  const until = await creditsModel.spendBoost(req.user.id, config.limits.boostDurationMs);
  if (!until) throw ApiError.paymentRequired('Tu n’as pas de Boost disponible.', { code: 'BOOST_EMPTY', source: 'discover_boost' });
  res.json({ success: true, data: { boostActifJusquau: until } });
});

/**
 * Aperçu live : combien de profils correspondraient aux préférences en cours
 * d'édition (body = filtres non encore enregistrés). Alimente le compteur de la
 * page Préférences.
 */
const countCandidates = catchAsync(async (req, res) => {
  const count = await discoveryModel.countCandidates(req.user.id, req.body || {});
  res.json({ success: true, data: { count } });
});

module.exports = { getCandidates, swipe, countCandidates, boost, likesReceived };
