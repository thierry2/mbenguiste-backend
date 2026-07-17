'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// entitlements.service — le payload lu par le front (useEntitlements) pour
// décider « action ou paywall ». Contrats :
//  - les capacités du domaine sont exposées telles quelles (le front gate sur
//    des CAPACITÉS, jamais sur un nom de palier — doctrine §3) ;
//  - les Super Likes ne sont JAMAIS « illimités » : quota compté pour tous ;
//  - les grants récurrents sont assurés AVANT la lecture des soldes (un membre
//    Or qui ouvre l'app lundi voit ses 5 Super Likes déjà crédités) ;
//  - générosité silencieuse : l'offert est un flag technique, premiumJusquau
//    reste nul (rien à « gérer », rien à afficher côté statut).
//
// Factory à dépendances injectées (testable à sec) + instance par défaut câblée
// sur access/grants/usage/credits réels, exportée pour le contrôleur profil.
// ─────────────────────────────────────────────────────────────────────────────
const defaultConfig = require('../config');
const defaultAccess = require('./access.service');
const defaultGrants = require('./grants.service');
const defaultUsage = require('../models/usage.model');
const defaultCredits = require('../models/credits.model');

function createEntitlementsService({ config, access, grants, usage, credits }) {
  async function forUser(userId, now = Date.now()) {
    const a = await access.forUser(userId, now); // { tier, offert, caps, premiumUntil, boostActiveUntil }

    // Grants récurrents d'ABORD : le solde lu juste après reflète les 5 Super
    // Likes du lundi, le Boost du mois, etc.
    await grants.ensure(userId, a.tier, a.offert, now);
    const solde = await credits.get(userId); // { superLikes, boosts, jokers }

    const L = config.limits;
    const quotas = {
      likes: a.caps.likesIllimites
        ? { illimite: true }
        : await counted(userId, 'like', L.freeLikesPer12h),
      // Le Super Like reste un consommable rare : compté même en premium.
      superLikes: await counted(userId, 'superlike', L.freeSuperLikesPerDay),
      // Like d'un Coup de cœur : 1 gratuit/jour, illimité en Or (picksIllimites).
      // Exposé pour que le front décompte le cœur des picks de façon déterministe.
      picks: a.caps.picksIllimites
        ? { illimite: true }
        : await counted(userId, 'picks_like', L.freePicksLikesPerDay),
      translations: a.caps.traductionIllimitee
        ? { illimite: true }
        : await counted(userId, 'translation', L.freeTranslationsPerDay),
    };

    return {
      estPremium: a.tier !== 'free',
      palier: a.tier,
      offert: a.offert, // TECHNIQUE (masquer la carte Plus), jamais un badge visible
      premiumJusquau: a.offert ? null : (a.premiumUntil ?? null),
      quotas,
      capacites: a.caps,
      credits: { coupsDeCoeur: solde.superLikes, boosts: solde.boosts, jokers: solde.jokers },
      boostActifJusquau: a.boostActiveUntil ?? null,
    };
  }

  async function counted(userId, kind, limite) {
    const { remaining, resetAt } = await usage.remaining(userId, kind, limite);
    return { illimite: false, restants: remaining, limite, resetLe: resetAt };
  }

  return { forUser };
}

const defaultService = createEntitlementsService({
  config: defaultConfig,
  access: defaultAccess,
  grants: defaultGrants,
  usage: defaultUsage,
  credits: defaultCredits,
});

module.exports = { createEntitlementsService, forUser: defaultService.forUser };
