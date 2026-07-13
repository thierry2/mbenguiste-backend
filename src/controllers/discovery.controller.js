const crypto = require('crypto');
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

const ONLINE_MS = 15 * 60 * 1000;

/**
 * Jeton OPAQUE d'un liker pour un viewer donné (HMAC — le client ne peut pas en
 * déduire l'identité). Sert de clé stable ; la résolution (lancer l'aventure) se
 * fera plus tard en le recomparant à la liste des likers en attente du viewer.
 */
function maskToken(viewerId, swiperId) {
  return crypto
    .createHmac('sha256', config.supabase.serviceKey)
    .update(`${viewerId}:${swiperId}`)
    .digest('base64url');
}

/**
 * « Qui t'a liké » — MASQUÉ pour tout le monde (le visage se mérite dans
 * l'aventure). On ne renvoie AUCUN champ identifiant : juste un jeton opaque, la
 * photo FLOUTÉE (blur_url) et le statut en ligne. `premiumRequis` gate l'ACTION
 * sur les likes normaux (les coups de cœur, eux, sont actionnables gratuitement).
 */
const likesReceived = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const pending = await discoveryModel.likersPending(viewerId);
  const premium = await profileModel.isPremium(viewerId);

  if (!pending.length) {
    return res.json({ success: true, data: { coeurs: [], likes: [], premiumRequis: !premium } });
  }

  const masked = await discoveryModel.maskedCardsByIds(pending.map((p) => p.id));
  const toItem = (p) => {
    const m = masked.get(p.id);
    return {
      id: maskToken(viewerId, p.id),
      blurUrl: m?.blurUrl ?? null,
      enLigne: m?.lastActiveAt ? Date.now() - new Date(m.lastActiveAt).getTime() < ONLINE_MS : false,
    };
  };

  const coeurs = pending.filter((p) => p.superLike).map(toItem);
  const likes = pending.filter((p) => !p.superLike).map(toItem);
  res.json({ success: true, data: { coeurs, likes, premiumRequis: !premium } });
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
