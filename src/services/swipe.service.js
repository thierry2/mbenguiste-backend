'use strict';
const ApiError = require('../utils/apiError');
const defaultConfig = require('../config');
const defaultSwipes = require('../models/swipe.model');
const defaultUsage = require('../models/usage.model');
const defaultCredits = require('../models/credits.model');
const defaultAccess = require('./access.service');
const defaultNotifications = require('./notification.service');

/**
 * Applique un swipe en faisant respecter capacités + quotas + crédits. C'est
 * ICI que se joue la conversion :
 *  - pass       : toujours autorisé ;
 *  - like       : illimité si la capacité le donne (Plus+, femme offerte),
 *                 sinon quota gratuit (20/12 h) puis paywall ;
 *  - super_like : quota 1/24 h POUR TOUT LE MONDE (doctrine 15/07 : l'Or n'a
 *                 plus de passe-droit — ses munitions arrivent par le grant
 *                 hebdo), puis crédit (acheté ou granté), puis paywall.
 *
 * En cas de blocage on lève un 402 avec un `code` + une `source` : le front
 * sait quel paywall ouvrir (et on mesure la conversion par surface).
 */
function createSwipeService({ config, access, usage, credits, swipes, notifications }) {
  async function applySwipe(userId, targetId, action, cible = null) {
    if (action === 'pass') return swipes.record(userId, targetId, action);
    if (action !== 'like' && action !== 'super_like') {
      throw ApiError.badRequest(`Action de swipe inconnue : ${action}`);
    }

    const { caps } = await access.forUser(userId);

    if (action === 'like' && !caps.likesIllimites) {
      const r = await usage.consume(userId, 'like', config.limits.freeLikesPer12h);
      if (!r.allowed) {
        throw ApiError.paymentRequired('Tu as utilisé tous tes likes pour le moment.', {
          code: 'LIKE_LIMIT', source: 'discover_likes', resetAt: r.resetAt,
        });
      }
    }

    if (action === 'super_like') {
      // Le gratuit du jour d'abord (on ne brûle jamais un crédit payé pour rien).
      const free = await usage.consume(userId, 'superlike', config.limits.freeSuperLikesPerDay);
      if (!free.allowed) {
        const spent = await credits.spendSuperLike(userId);
        if (!spent) {
          throw ApiError.paymentRequired('Tu n’as plus de Super Likes.', {
            code: 'SUPERLIKE_EMPTY', source: 'discover_superlike',
          });
        }
      }
    }

    const res = await swipes.record(userId, targetId, action, cible);

    // Le Super Like traverse le paywall par le DECK + un push teaser (doctrine).
    // Best-effort : le push ne doit jamais faire échouer le swipe déjà enregistré.
    if (action === 'super_like') {
      try {
        await notifications.onSuperLikeReceived(targetId);
      } catch { /* silencieux */ }
    }
    return res;
  }

  /**
   * Rewind (Lot C) : annule le dernier swipe. Réservé au palier Plus et au-dessus
   * (capacité `peutRewind`). Le modèle efface le swipe (et le match qu'il aurait
   * formé, pour rester cohérent) et rend la cible à remettre en tête du deck.
   */
  async function rewindLast(userId) {
    const { caps } = await access.forUser(userId);
    if (!caps.peutRewind) {
      throw ApiError.paymentRequired('Reviens en arrière avec Plus.', {
        code: 'REWIND_LOCKED', source: 'discover_rewind',
      });
    }
    const last = await swipes.deleteLast(userId);
    if (!last) throw ApiError.badRequest('Aucun swipe à annuler.');
    return last; // { targetId, action } → le front réinsère la carte
  }

  return { applySwipe, rewindLast };
}

const defaultService = createSwipeService({
  config: defaultConfig,
  access: defaultAccess,
  usage: defaultUsage,
  credits: defaultCredits,
  swipes: defaultSwipes,
  notifications: defaultNotifications,
});

module.exports = {
  createSwipeService,
  applySwipe: defaultService.applySwipe,
  rewindLast: defaultService.rewindLast,
};
