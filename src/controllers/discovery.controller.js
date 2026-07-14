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
  const { action, cible } = req.body;
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se swiper soi-même');

  const { match } = await swipeService.applySwipe(req.user.id, targetId, action, cible ?? null);
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
 * « Qui t'a liké » — modèle classique (Tinder).
 *   • Coups de cœur (super-like) : TOUJOURS révélés (visage + prénom/âge/ville),
 *     même en gratuit — c'est la promesse du super-like. On expose le vrai id
 *     profil pour permettre de liker en retour / ouvrir le profil.
 *   • Likes ordinaires : révélés seulement en PREMIUM ; en gratuit ils restent
 *     masqués (jeton opaque + photo floutée) derrière le paywall.
 * `premiumRequis` (= !premium) gate la révélation des likes ordinaires.
 */
const online = (lastActiveAt) => !!lastActiveAt && Date.now() - new Date(lastActiveAt).getTime() < ONLINE_MS;

const likesReceived = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const pending = await discoveryModel.likersPending(viewerId);
  const premium = await profileModel.isPremium(viewerId);

  if (!pending.length) {
    return res.json({ success: true, data: { coeurs: [], likes: [], premiumRequis: !premium } });
  }

  const coeursPending = pending.filter((p) => p.superLike);
  const likesPending = pending.filter((p) => !p.superLike);

  // Cartes RÉVÉLÉES : les coups de cœur pour tous, les likes ordinaires en premium.
  const revealPending = [...coeursPending, ...(premium ? likesPending : [])];
  const revealIds = revealPending.map((p) => p.id);
  const cards = revealIds.length ? await discoveryModel.cardsByIds(revealIds) : new Map();
  // Coords SERVEUR ONLY → distance en km, sans jamais renvoyer la position brute.
  const coords = revealIds.length ? await discoveryModel.coordsByIds([viewerId, ...revealIds]) : new Map();
  const moi = coords.get(viewerId);
  const distanceKm = (id) => {
    const c = coords.get(id);
    if (!moi || moi.lat == null || moi.lng == null || !c || c.lat == null || c.lng == null) return null;
    return Math.round(discoveryModel.haversineKm(moi.lat, moi.lng, c.lat, c.lng));
  };
  // Accroche = 1re réponse de prompt, sinon la bio (contexte humain sur la carte).
  const accrocheDe = (c) => {
    const p = (c?.prompts ?? []).find((x) => x.reponse && x.reponse.trim());
    return (p?.reponse ?? c?.bio ?? null)?.trim() || null;
  };
  const toRevealed = (p) => {
    const c = cards.get(p.id);
    return {
      id: p.id,                          // vrai id profil (liker en retour / ouvrir profil)
      revele: true,
      superLike: p.superLike,
      prenom: c?.prenom ?? null,
      age: c?.age ?? null,
      ville: c?.villeActuelle ?? null,
      distanceKm: distanceKm(p.id),
      accroche: accrocheDe(c),
      photoUrl: c?.avatarUrl ?? c?.photos?.[0]?.url ?? null,
      estVerifie: c?.estVerifie ?? false,
      enLigne: online(c?.lastActiveAt),
    };
  };

  const coeurs = coeursPending.map(toRevealed);

  let likes;
  if (premium) {
    likes = likesPending.map(toRevealed);
  } else {
    const masked = await discoveryModel.maskedCardsByIds(likesPending.map((p) => p.id));
    likes = likesPending.map((p) => {
      const m = masked.get(p.id);
      return {
        id: maskToken(viewerId, p.id),   // jeton opaque : aucune fuite d'identité
        revele: false,
        superLike: false,
        blurUrl: m?.blurUrl ?? null,
        enLigne: online(m?.lastActiveAt),
      };
    });
  }

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
