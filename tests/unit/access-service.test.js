'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// access.service — LE point de décision unique « qui a droit à quoi ».
// Remplace tous les anciens appels à profileModel.isPremium. On teste le
// branchement service (lecture profil → domaine) ; la logique fine est
// couverte par domain-access.test.js.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAccessService } = require('../../src/services/access.service');

const FUTUR = new Date(Date.now() + 86_400_000).toISOString();
const PASSE = new Date(Date.now() - 86_400_000).toISOString();

function makeService(row, { freeTierWomen = false } = {}) {
  const profiles = { async accessRow() { return row; } };
  const config = { freeTierWomen };
  return createAccessService({ config, profiles });
}

test('profil inconnu (supprimé) → free sans capacités', async () => {
  const acc = await makeService(null).forUser('u1');
  assert.equal(acc.tier, 'free');
  assert.equal(acc.offert, false);
  assert.equal(acc.caps.likesIllimites, false);
});

test('abonnement prestige actif → tier + capacités du domaine', async () => {
  const acc = await makeService({
    premiumTier: 'prestige', premiumUntil: FUTUR, isPremium: true, genderCode: 'man', boostActiveUntil: null,
  }).forUser('u1');
  assert.equal(acc.tier, 'prestige');
  assert.equal(acc.caps.priorityLikes, true);
  assert.equal(acc.premiumUntil, FUTUR);
});

test('compat pré-migration : is_premium=true sans premium_tier → traité comme or', async () => {
  const acc = await makeService({
    premiumTier: null, premiumUntil: FUTUR, isPremium: true, genderCode: 'man', boostActiveUntil: null,
  }).forUser('u1');
  assert.equal(acc.tier, 'or');
  assert.equal(acc.offert, false);
});

test('abonnement expiré → free (le garde-fou du domaine s\'applique)', async () => {
  const acc = await makeService({
    premiumTier: 'or', premiumUntil: PASSE, isPremium: true, genderCode: 'man', boostActiveUntil: null,
  }).forUser('u1');
  assert.equal(acc.tier, 'free');
});

test('femme + flag → or offert, générosité silencieuse (grille JAMAIS défloutée)', async () => {
  const acc = await makeService(
    { premiumTier: null, premiumUntil: null, isPremium: false, genderCode: 'woman', boostActiveUntil: null },
    { freeTierWomen: true },
  ).forUser('u1');
  assert.equal(acc.tier, 'or');
  assert.equal(acc.offert, true);
  assert.equal(acc.caps.likesIllimites, true);
  assert.equal(acc.caps.grilleDefloutee, false);
});

test('boost actif : l\'échéance future est exposée, une échéance passée devient null', async () => {
  const accActif = await makeService({
    premiumTier: null, premiumUntil: null, isPremium: false, genderCode: 'man', boostActiveUntil: FUTUR,
  }).forUser('u1');
  assert.equal(accActif.boostActiveUntil, FUTUR);

  const accFini = await makeService({
    premiumTier: null, premiumUntil: null, isPremium: false, genderCode: 'man', boostActiveUntil: PASSE,
  }).forUser('u1');
  assert.equal(accFini.boostActiveUntil, null);
});
