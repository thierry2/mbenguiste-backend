'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// entitlements.service — le payload lu par le front (useEntitlements) pour
// décider « action ou paywall ». Contrats vérifiés :
//  - les capacités du domaine sont exposées telles quelles (le front gate sur
//    des CAPACITÉS, jamais sur un nom de palier — doctrine §3) ;
//  - les Super Likes ne sont JAMAIS « illimités » : quota 1/24 h pour tous ;
//  - les grants récurrents sont assurés AVANT la lecture des soldes (un membre
//    Or qui ouvre l'app lundi voit ses 5 Super Likes déjà crédités) ;
//  - générosité silencieuse : l'offert est un flag technique, premiumJusquau
//    reste nul (rien à « gérer », rien à afficher).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEntitlementsService } = require('../../src/services/entitlements.service');
const { capabilitiesFor } = require('../../src/domain/access');

const FUTUR = new Date(Date.now() + 86_400_000).toISOString();

const CONFIG = { limits: { freeLikesPer12h: 20, freeSuperLikesPerDay: 1, freeTranslationsPerDay: 10, freePicksLikesPerDay: 1 } };

function makeService({ tier = 'free', offert = false, premiumUntil = null, boostActiveUntil = null, credits = {}, used = {} } = {}) {
  const journal = { grantCalls: [], readOrder: [] };

  const access = {
    async forUser() {
      journal.readOrder.push('access');
      return { tier, offert, caps: capabilitiesFor(tier, offert), premiumUntil, boostActiveUntil };
    },
  };
  const grants = {
    async ensure(userId, t, o, now) {
      journal.grantCalls.push({ userId, tier: t, offert: o, now });
      journal.readOrder.push('grants');
    },
  };
  const creditsModel = {
    async get() {
      journal.readOrder.push('credits');
      return { superLikes: 0, boosts: 0, jokers: 0, ...credits };
    },
  };
  const usage = {
    async remaining(userId, kind, limit) {
      const u = used[kind] ?? 0;
      return { remaining: Math.max(0, limit - u), resetAt: '2026-07-16T00:00:00.000Z' };
    },
  };

  const service = createEntitlementsService({
    config: CONFIG, access, grants, usage, credits: creditsModel,
  });
  return { service, journal };
}

// ── Gratuit ──────────────────────────────────────────────────────────────────

test('gratuit : tous les quotas comptés, capacités à false, crédits à zéro', async () => {
  const { service } = makeService({ used: { like: 5, superlike: 1, translation: 3 } });
  const e = await service.forUser('u1');

  assert.equal(e.estPremium, false);
  assert.equal(e.palier, 'free');
  assert.equal(e.offert, false);
  assert.deepEqual(e.quotas.likes, { illimite: false, restants: 15, limite: 20, resetLe: '2026-07-16T00:00:00.000Z' });
  assert.deepEqual(e.quotas.superLikes, { illimite: false, restants: 0, limite: 1, resetLe: '2026-07-16T00:00:00.000Z' });
  assert.deepEqual(e.quotas.picks, { illimite: false, restants: 1, limite: 1, resetLe: '2026-07-16T00:00:00.000Z' }, 'quota picks exposé');
  assert.deepEqual(e.quotas.translations, { illimite: false, restants: 7, limite: 10, resetLe: '2026-07-16T00:00:00.000Z' });
  assert.equal(e.capacites.grilleDefloutee, false);
  assert.deepEqual(e.credits, { coupsDeCoeur: 0, boosts: 0, jokers: 0 });
});

// ── Or payé ──────────────────────────────────────────────────────────────────

test('or payé : likes/traduction illimités, Super Likes RESTENT comptés (jamais illimités)', async () => {
  const { service } = makeService({
    tier: 'or', premiumUntil: FUTUR, credits: { superLikes: 5 }, used: { superlike: 1 },
  });
  const e = await service.forUser('u1');

  assert.equal(e.estPremium, true);
  assert.equal(e.palier, 'or');
  assert.deepEqual(e.quotas.likes, { illimite: true });
  assert.deepEqual(e.quotas.translations, { illimite: true });
  assert.deepEqual(e.quotas.picks, { illimite: true }, 'Or : picks illimités (picksIllimites)');
  assert.equal(e.quotas.superLikes.illimite, false, 'doctrine 15/07 : l\'Or n\'a PLUS de Super Likes illimités');
  assert.equal(e.quotas.superLikes.restants, 0);
  assert.equal(e.credits.coupsDeCoeur, 5, 'ses munitions viennent du grant hebdo');
  assert.equal(e.capacites.grilleDefloutee, true);
  assert.equal(e.premiumJusquau, FUTUR);
});

// ── Or offert (femme, flag on) ───────────────────────────────────────────────

test('or offert : capacités de confort, révélation exclue, RIEN à afficher côté statut', async () => {
  const { service } = makeService({ tier: 'or', offert: true, credits: { superLikes: 5, boosts: 1 } });
  const e = await service.forUser('u1');

  assert.equal(e.estPremium, true, 'compat : les gardes serveur type traduction la traitent en or');
  assert.equal(e.offert, true, 'flag TECHNIQUE (masquer la carte Plus), jamais un badge');
  assert.equal(e.premiumJusquau, null, 'générosité silencieuse : aucune échéance à « gérer »');
  assert.equal(e.quotas.likes.illimite, true);
  assert.equal(e.capacites.grilleDefloutee, false, 'invariant n°5');
  assert.equal(e.capacites.picksIllimites, false, 'invariant n°5');
  assert.equal(e.credits.coupsDeCoeur, 5);
});

// ── Prestige ─────────────────────────────────────────────────────────────────

test('prestige : jokers exposés dans les crédits, capacités complètes', async () => {
  const { service } = makeService({ tier: 'prestige', premiumUntil: FUTUR, credits: { jokers: 2 } });
  const e = await service.forUser('u1');
  assert.equal(e.credits.jokers, 2);
  assert.equal(e.capacites.priorityLikes, true);
  assert.equal(e.capacites.motAvantMatch, true);
});

// ── Grants : appelés, au bon moment ──────────────────────────────────────────

test('les grants sont assurés pour le bon palier AVANT la lecture des soldes', async () => {
  const { service, journal } = makeService({ tier: 'or', offert: true });
  await service.forUser('u42');

  assert.equal(journal.grantCalls.length, 1);
  assert.equal(journal.grantCalls[0].userId, 'u42');
  assert.equal(journal.grantCalls[0].tier, 'or');
  assert.equal(journal.grantCalls[0].offert, true);

  const iGrants = journal.readOrder.indexOf('grants');
  const iCredits = journal.readOrder.indexOf('credits');
  assert.ok(iGrants < iCredits, 'grant d\'abord, lecture des soldes ensuite (le lundi matin montre les 5 Super Likes)');
});

test('boost actif exposé tel que fourni par l\'accès', async () => {
  const { service } = makeService({ boostActiveUntil: FUTUR });
  const e = await service.forUser('u1');
  assert.equal(e.boostActifJusquau, FUTUR);
});
