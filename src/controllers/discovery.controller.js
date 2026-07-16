const crypto = require('crypto');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const config = require('../config');
const discoveryModel = require('../models/discovery.model');
const accessService = require('../services/access.service');
const swipeService = require('../services/swipe.service');
const picksService = require('../services/picks.service');
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

/**
 * Rewind (Lot C) : annule le dernier swipe. Réservé au palier Plus+ (le service
 * lève un 402 REWIND_LOCKED sinon). Renvoie la carte à restaurer en tête du deck.
 */
const rewind = catchAsync(async (req, res) => {
  const restore = await swipeService.rewindLast(req.user.id);
  res.json({ success: true, data: { restore } });
});

/**
 * Coups de cœur du jour (Lot E) : la sélection algorithmique du jour, visible en
 * clair par tout le monde. Le paywall est sur l'ACTION de liker (POST picks/:id/like).
 */
const dailyPicks = catchAsync(async (req, res) => {
  const picks = await picksService.dailySelection(req.user.id);
  res.json({ success: true, data: { picks } });
});

/**
 * Liker un Coup de cœur du jour. Gratuit 1×/jour, au-delà = Or (le service lève
 * un 402 PICKS_LIMIT / picks_like sinon). Renvoie le match éventuel.
 */
const likePick = catchAsync(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se liker soi-même');
  const { cible } = req.body || {};
  const { match } = await picksService.likeFromPicks(req.user.id, targetId, cible ?? null);
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
 * « Qui t'a liké » — LA grille que vend l'Or (doctrine 15/07).
 *
 * La révélation est gatée par la CAPACITÉ `grilleDefloutee` (Or payé — jamais un
 * palier offert : invariant n°5, « la révélation ne s'offre jamais, elle se vend »),
 * jamais par un nom de palier ni par is_premium.
 *   • Sans la capacité : TOUT est masqué (jeton opaque + photo floutée). Les
 *     super-likes restent masqués eux aussi, mais MARQUÉS ⚡ — le teaser qui vend
 *     l'Or. La destinataire les découvre en clair dans son DECK (carte marquée) et
 *     par le push : c'est là que le Super Like traverse le paywall, pas ici.
 *   • Avec la capacité : tout est révélé, les super-likes épinglés en tête ⚡.
 * `premiumRequis` (= !grilleDefloutee) dit au front d'afficher le paywall.
 */
const online = (lastActiveAt) => !!lastActiveAt && Date.now() - new Date(lastActiveAt).getTime() < ONLINE_MS;

const likesReceived = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const pending = await discoveryModel.likersPending(viewerId);
  const { caps } = await accessService.forUser(viewerId);
  const revele = caps.grilleDefloutee;

  if (!pending.length) {
    return res.json({ success: true, data: { coeurs: [], likes: [], premiumRequis: !revele } });
  }

  const coeursPending = pending.filter((p) => p.superLike);
  const likesPending = pending.filter((p) => !p.superLike);

  // Cartes RÉVÉLÉES : uniquement si la capacité est là — sinon rien, pas même les
  // super-likes (leur révélation se joue dans le deck, cf. en-tête).
  const revealPending = revele ? [...coeursPending, ...likesPending] : [];
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

  // Sans la capacité : tout est masqué. Les super-likes gardent leur marque ⚡
  // (le teaser qui vend l'Or), mais AUCUN champ identifiant ne sort d'ici.
  const masked = revele
    ? new Map()
    : await discoveryModel.maskedCardsByIds(pending.map((p) => p.id));
  const toMasked = (p) => {
    const m = masked.get(p.id);
    return {
      id: maskToken(viewerId, p.id),     // jeton opaque : aucune fuite d'identité
      revele: false,
      superLike: p.superLike,            // ⚡ visible, identité non
      blurUrl: m?.blurUrl ?? null,
      enLigne: online(m?.lastActiveAt),
    };
  };

  const rendre = (p) => (revele ? toRevealed(p) : toMasked(p));
  const coeurs = coeursPending.map(rendre);
  const likes = likesPending.map(rendre);

  res.json({ success: true, data: { coeurs, likes, premiumRequis: !revele } });
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

module.exports = { getCandidates, swipe, rewind, dailyPicks, likePick, countCandidates, boost, likesReceived };
