const config = require('../config');
const supabase = require('../config/supabase');
const profileModel = require('../models/profile.model');
const creditsModel = require('../models/credits.model');
const usage = require('../models/usage.model');

/**
 * Droits & compteurs de l'utilisateur — source unique lue par le front
 * (`useEntitlements`) pour décider « action ou paywall ». Les membres Or ont des
 * quotas illimités.
 */
async function forUser(userId) {
  const [premium, credits] = await Promise.all([
    profileModel.isPremium(userId),
    creditsModel.get(userId),
  ]);

  const { data: prof } = await supabase
    .from('profiles')
    .select('premium_until, boost_active_until')
    .eq('id', userId)
    .maybeSingle();

  const boostActif = prof?.boost_active_until && new Date(prof.boost_active_until).getTime() > Date.now();

  let quotas;
  if (premium) {
    quotas = {
      likes:        { illimite: true },
      superLikes:   { illimite: true },
      translations: { illimite: true },
    };
  } else {
    const [likes, superLikes, translations] = await Promise.all([
      usage.remaining(userId, 'like', config.limits.freeLikesPer12h),
      usage.remaining(userId, 'superlike', config.limits.freeSuperLikesPerDay),
      usage.remaining(userId, 'translation', config.limits.freeTranslationsPerDay),
    ]);
    quotas = {
      likes:        { illimite: false, restants: likes.remaining,        limite: config.limits.freeLikesPer12h,        resetLe: likes.resetAt },
      superLikes:   { illimite: false, restants: superLikes.remaining,   limite: config.limits.freeSuperLikesPerDay,   resetLe: superLikes.resetAt },
      translations: { illimite: false, restants: translations.remaining, limite: config.limits.freeTranslationsPerDay, resetLe: translations.resetAt },
    };
  }

  return {
    estPremium: premium,
    premiumJusquau: premium ? (prof?.premium_until ?? null) : null,
    credits: { coupsDeCoeur: credits.superLikes, boosts: credits.boosts },
    boostActifJusquau: boostActif ? prof.boost_active_until : null,
    quotas,
  };
}

module.exports = { forUser };
