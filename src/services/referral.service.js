'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// referral.service — attribution d'un membre à un code partenaire À L'INSCRIPTION
// + cadeau de bienvenue, servi par NOTRE moteur (jamais par un offer code store).
//
// Cadeau (doctrine 18/07, don d'accueil PONCTUEL) : 7 jours d'essai Plus + 3
// Super Likes + 1 Boost. Les Super Likes en don d'accueil sont une exception
// assumée à « jamais offert » (qui vise l'allocation Or récurrente, pas ce don).
//
// Le 1er code gagne (referrals.attach idempotent) → le cadeau n'est versé QU'UNE
// fois. Factory à dépendances injectées (testable à sec).
// ─────────────────────────────────────────────────────────────────────────────
const defaultReferrals = require('../models/referrals.model');
const defaultPartners = require('../models/partners.model');
const defaultProfiles = require('../models/profile.model');
const defaultCredits = require('../models/credits.model');

const WELCOME_GIFT = { trialTier: 'plus', trialDays: 7, superLikes: 3, boosts: 1 };
const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (code) => String(code || '').trim().toUpperCase();

function createReferralService({ referrals, partners, profiles, credits, now }) {
  const clock = now || (() => new Date());

  /** Validation live pour la puce de confirmation à l'onboarding. */
  async function lookup(rawCode) {
    const code = normalize(rawCode);
    if (code.length < 2) return { valid: false };
    const p = await partners.findByPromoCode(code);
    if (!p || p.status === 'frozen') return { valid: false };
    return { valid: true, code, partnerName: p.displayName };
  }

  /** Attache le membre au code (1er gagne) et verse le cadeau au 1er rattachement. */
  async function redeem({ profileId, code: rawCode, source = 'manual' }) {
    const code = normalize(rawCode);
    const p = await partners.findByPromoCode(code);
    if (!p || p.status === 'frozen') return { attributed: false, reason: 'invalid_code' };

    const attached = await referrals.attach({ profileId, code, partnerId: p.partnerId, source });
    if (!attached) return { attributed: false, reason: 'already_referred', partnerName: p.displayName };

    const gift = await grantWelcome(profileId);
    return { attributed: true, partnerName: p.displayName, gift };
  }

  /** Verse le cadeau. L'essai Plus n'écrase jamais un abonnement déjà actif. */
  async function grantWelcome(profileId) {
    const access = await profiles.accessRow(profileId);
    const alreadyPremium = !!(access && access.isPremium);

    if (!alreadyPremium) {
      const until = new Date(clock().getTime() + WELCOME_GIFT.trialDays * DAY_MS).toISOString();
      await profiles.setPremiumStatus(profileId, {
        isPremium: true, tier: WELCOME_GIFT.trialTier, premiumUntil: until,
      });
    }
    await credits.grant(profileId, { superLikes: WELCOME_GIFT.superLikes, boosts: WELCOME_GIFT.boosts });

    return { ...WELCOME_GIFT, trialApplied: !alreadyPremium };
  }

  return { lookup, redeem };
}

const defaultService = createReferralService({
  referrals: defaultReferrals,
  partners: defaultPartners,
  profiles: defaultProfiles,
  credits: defaultCredits,
});

module.exports = { createReferralService, WELCOME_GIFT, lookup: defaultService.lookup, redeem: defaultService.redeem };
