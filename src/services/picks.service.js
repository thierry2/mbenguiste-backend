'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// picks.service — les Coups de cœur du jour (doctrine 15/07). La sélection est
// une CURATION algorithmique (domaine picks) que tout le monde voit en clair ;
// le paywall est sur l'ACTION : liker est gratuit 1×/jour, au-delà = Or
// (402 picks_like). La capacité `picksIllimites` (Or payé, jamais l'offert —
// invariant n°5) libère l'action.
//
// Factory à dépendances injectées + instance par défaut câblée pour le contrôleur.
// ─────────────────────────────────────────────────────────────────────────────
const ApiError = require('../utils/apiError');
const defaultConfig = require('../config');
const defaultAccess = require('./access.service');
const defaultUsage = require('../models/usage.model');
const defaultSwipes = require('../models/swipe.model');
const defaultDiscovery = require('../models/discovery.model');
const defaultProfiles = require('../models/profile.model');
const { selectDailyPicks } = require('../domain/picks');

// Taille du vivier scoré pour en extraire la sélection du jour.
const POOL = 60;
const SELECTION_SIZE = 10;

function createPicksService({ config, access, usage, swipes, discovery, profiles }) {
  /** La sélection du jour pour `userId` (curation algorithmique, stable 24 h). */
  async function dailySelection(userId, { count = SELECTION_SIZE, now = Date.now() } = {}) {
    const [viewer, pool] = await Promise.all([
      profiles.findById(userId),
      discovery.candidates(userId, { limit: POOL }),
    ]);
    return selectDailyPicks(pool, viewer, { count, now });
  }

  /**
   * Liker un profil de la sélection. Gratuit 1×/jour (quota picks_like dédié),
   * illimité si `picksIllimites`. Au-delà → 402 picks_like (source la plus chaude).
   */
  async function likeFromPicks(userId, targetId, cible = null) {
    const { caps } = await access.forUser(userId);
    if (!caps.picksIllimites) {
      const r = await usage.consume(userId, 'picks_like', config.limits.freePicksLikesPerDay);
      if (!r.allowed) {
        throw ApiError.paymentRequired('Ton Coup de cœur du jour est déjà donné.', {
          code: 'PICKS_LIMIT', source: 'picks_like', resetAt: r.resetAt,
        });
      }
    }
    return swipes.record(userId, targetId, 'like', cible);
  }

  return { dailySelection, likeFromPicks };
}

const defaultService = createPicksService({
  config: defaultConfig,
  access: defaultAccess,
  usage: defaultUsage,
  swipes: defaultSwipes,
  discovery: defaultDiscovery,
  profiles: defaultProfiles,
});

module.exports = {
  createPicksService,
  dailySelection: defaultService.dailySelection,
  likeFromPicks: defaultService.likeFromPicks,
};
