const ApiError = require('../utils/apiError');
const config = require('../config');
const swipeModel = require('../models/swipe.model');
const profileModel = require('../models/profile.model');
const usage = require('../models/usage.model');
const credits = require('../models/credits.model');

/**
 * Applique un swipe en faisant respecter quotas gratuits + crédits. C'est ICI que
 * se joue la conversion :
 *  - pass       : toujours autorisé ;
 *  - like       : illimité si Or, sinon quota gratuit (12 h) puis paywall ;
 *  - super_like : illimité si Or, sinon 1 gratuit/jour, puis crédit acheté, puis paywall.
 *
 * En cas de blocage on lève un 402 avec un `code` + une `source` : le front sait
 * quel paywall ouvrir (et on mesure la conversion par surface).
 */
async function applySwipe(userId, targetId, action, cible = null) {
  if (action === 'pass') return swipeModel.record(userId, targetId, action);

  const premium = await profileModel.isPremium(userId);

  if (action === 'like' && !premium) {
    const r = await usage.consume(userId, 'like', config.limits.freeLikesPer12h);
    if (!r.allowed) {
      throw ApiError.paymentRequired('Tu as utilisé tous tes likes pour le moment.', {
        code: 'LIKE_LIMIT', source: 'discover_likes', resetAt: r.resetAt,
      });
    }
  }

  if (action === 'super_like' && !premium) {
    const free = await usage.consume(userId, 'superlike', config.limits.freeSuperLikesPerDay);
    if (!free.allowed) {
      const spent = await credits.spendSuperLike(userId);
      if (!spent) {
        throw ApiError.paymentRequired('Tu n’as plus de Coups de cœur.', {
          code: 'SUPERLIKE_EMPTY', source: 'discover_superlike',
        });
      }
    }
  }

  return swipeModel.record(userId, targetId, action, cible);
}

module.exports = { applySwipe };
