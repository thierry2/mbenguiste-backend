'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine ACCÈS (pur, zéro I/O) — la doctrine des offres traduite en code :
//  - resolveTier : qui a quel palier (payé, offert femmes, expiré, flag off) ;
//  - capabilitiesFor : la matrice COMPLÈTE palier × offert (invariant n°5 :
//    la révélation ne s'offre jamais) ;
//  - grantsDue : quels grants récurrents sont dus à quel palier ;
//  - periodKey : clés de période stables (mois, semaine ISO — bords d'année).
// Réf. : docs/doctrine-offres.md
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TIERS, atLeast, resolveTier, capabilitiesFor, grantsDue, periodKey,
} = require('../../src/domain/access');

const NOW = new Date('2026-07-15T12:00:00Z').getTime();
const FUTUR = new Date('2026-12-31T00:00:00Z').toISOString();
const PASSE = new Date('2026-01-01T00:00:00Z').toISOString();

// ── Ordre des paliers ────────────────────────────────────────────────────────

test('paliers : ordre free < plus < or < prestige', () => {
  assert.deepEqual(TIERS, ['free', 'plus', 'or', 'prestige']);
  assert.ok(atLeast('plus', 'plus'));
  assert.ok(atLeast('or', 'plus'));
  assert.ok(atLeast('prestige', 'or'));
  assert.ok(!atLeast('free', 'plus'));
  assert.ok(!atLeast('plus', 'or'));
  assert.ok(!atLeast('or', 'prestige'));
});

// ── resolveTier : payé, offert, expiré ───────────────────────────────────────

test('resolveTier : sans rien → free', () => {
  const r = resolveTier({ premiumTier: null, premiumUntil: null, genderCode: 'man', freeTierWomen: false, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

for (const tier of ['plus', 'or', 'prestige']) {
  test(`resolveTier : abonnement ${tier} actif → ${tier} payé`, () => {
    const r = resolveTier({ premiumTier: tier, premiumUntil: FUTUR, genderCode: 'man', freeTierWomen: false, now: NOW });
    assert.deepEqual(r, { tier, offert: false });
  });
}

test('resolveTier : premium_until passé = expiré → free (garde-fou webhook raté)', () => {
  const r = resolveTier({ premiumTier: 'or', premiumUntil: PASSE, genderCode: 'man', freeTierWomen: false, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

test('resolveTier : premium_until null = pas d\'échéance connue → le tier payé vaut', () => {
  const r = resolveTier({ premiumTier: 'or', premiumUntil: null, genderCode: 'man', freeTierWomen: false, now: NOW });
  assert.deepEqual(r, { tier: 'or', offert: false });
});

test('resolveTier : palier inconnu en base → ignoré (free)', () => {
  const r = resolveTier({ premiumTier: 'diamant', premiumUntil: FUTUR, genderCode: 'man', freeTierWomen: false, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

// ── Gratuité femmes (flag) ───────────────────────────────────────────────────

test('femme + flag ON → PLUS offert (décision 18/07 : gratuité = Plus, pas Or)', () => {
  // La gratuité femmes = le palier Plus (likes ∞, rewind ∞, incognito) et RIEN
  // d'autre : ni Super Like (traverse le paywall de l'homme → match gratuit), ni
  // grille défloutée (idem via ses likes reçus), ni Boost (si toutes boostent,
  // le Boost ne vaut plus rien). Tout ce qui fabrique du match gratuit côté homme
  // est exclu — donc pas Or.
  const r = resolveTier({ premiumTier: null, premiumUntil: null, genderCode: 'woman', freeTierWomen: true, now: NOW });
  assert.deepEqual(r, { tier: 'plus', offert: true });
});

test('femme + flag OFF → free (désactivation instantanée)', () => {
  const r = resolveTier({ premiumTier: null, premiumUntil: null, genderCode: 'woman', freeTierWomen: false, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

test('homme + flag ON → free (la gratuité ne fuit pas)', () => {
  const r = resolveTier({ premiumTier: null, premiumUntil: null, genderCode: 'man', freeTierWomen: true, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

test('genre inconnu/null + flag ON → free (prudence)', () => {
  const r = resolveTier({ premiumTier: null, premiumUntil: null, genderCode: null, freeTierWomen: true, now: NOW });
  assert.deepEqual(r, { tier: 'free', offert: false });
});

test('femme + flag ON + abonnement payé → le PAYÉ gagne (jamais rétrogradée en offert)', () => {
  // Une femme qui a acheté Prestige garde Prestige payé.
  const r = resolveTier({ premiumTier: 'prestige', premiumUntil: FUTUR, genderCode: 'woman', freeTierWomen: true, now: NOW });
  assert.deepEqual(r, { tier: 'prestige', offert: false });
});

test('femme + flag ON + abonnement Or EXPIRÉ → retombe sur PLUS offert (pas free)', () => {
  const r = resolveTier({ premiumTier: 'or', premiumUntil: PASSE, genderCode: 'woman', freeTierWomen: true, now: NOW });
  assert.deepEqual(r, { tier: 'plus', offert: true });
});

// ── Matrice des capacités : doctrine §1/§2 + invariant n°5 ───────────────────

test('capacités FREE : rien au-delà du socle', () => {
  const c = capabilitiesFor('free', false);
  assert.deepEqual(c, {
    likesIllimites: false,
    peutRewind: false,
    peutIncognito: false,
    filtresAvances: false,
    traductionIllimitee: false,
    grilleDefloutee: false,
    picksIllimites: false,
    priorityLikes: false,
    motAvantMatch: false,
  });
});

test('capacités PLUS : confort de mon côté de l\'écran, aucune révélation', () => {
  const c = capabilitiesFor('plus', false);
  assert.equal(c.likesIllimites, true);
  assert.equal(c.peutRewind, true);
  assert.equal(c.peutIncognito, true);
  assert.equal(c.filtresAvances, false);
  assert.equal(c.traductionIllimitee, false);
  assert.equal(c.grilleDefloutee, false);
  assert.equal(c.picksIllimites, false);
  assert.equal(c.priorityLikes, false);
});

test('capacités OR payé : Plus inclus + révélation + filtres + traduction', () => {
  const c = capabilitiesFor('or', false);
  assert.equal(c.likesIllimites, true);
  assert.equal(c.peutRewind, true);
  assert.equal(c.peutIncognito, true);
  assert.equal(c.filtresAvances, true);
  assert.equal(c.traductionIllimitee, true);
  assert.equal(c.grilleDefloutee, true);
  assert.equal(c.picksIllimites, true);
  assert.equal(c.priorityLikes, false);
  assert.equal(c.motAvantMatch, false);
});

test('capacités OR OFFERT : tout l\'Or SAUF la révélation (invariant n°5)', () => {
  const c = capabilitiesFor('or', true);
  assert.equal(c.likesIllimites, true, 'confort offert');
  assert.equal(c.peutRewind, true);
  assert.equal(c.peutIncognito, true);
  assert.equal(c.filtresAvances, true);
  assert.equal(c.grilleDefloutee, false, 'JAMAIS offert : les likes des hommes gratuits ne doivent pas arriver en clair');
  assert.equal(c.picksIllimites, false, 'JAMAIS offert : liker depuis la sélection reste vendu');
  // La traduction appelle Gemini à CHAQUE message : elle a un coût marginal réel,
  // contrairement au confort (likes, rewind, incognito) qui ne coûte rien à offrir.
  // On n'offre donc jamais ce qu'on paie à l'usage — même dans la gratuité femmes.
  assert.equal(c.traductionIllimitee, false, 'JAMAIS offerte : coût Gemini par appel');
});

test('capacités PLUS OFFERT (ce que reçoit une femme) : confort seul, zéro Or', () => {
  const c = capabilitiesFor('plus', true);
  assert.equal(c.likesIllimites, true);
  assert.equal(c.peutRewind, true);
  assert.equal(c.peutIncognito, true);
  assert.equal(c.filtresAvances, false);
  assert.equal(c.grilleDefloutee, false);
  assert.equal(c.picksIllimites, false);
  assert.equal(c.traductionIllimitee, false);
});

test('capacités PRESTIGE payé : Or inclus + priorité + mot avant match', () => {
  const c = capabilitiesFor('prestige', false);
  assert.equal(c.grilleDefloutee, true);
  assert.equal(c.picksIllimites, true);
  assert.equal(c.priorityLikes, true);
  assert.equal(c.motAvantMatch, true);
});

// ── Grants récurrents dus par palier (doctrine §2) ───────────────────────────

test('grants FREE : aucun', () => {
  assert.deepEqual(grantsDue('free', false), []);
});

test('grants PLUS : aucun (le palier ne porte que du confort)', () => {
  assert.deepEqual(grantsDue('plus', false), []);
});

test('grants OR payé : 5 Super Likes/semaine + 1 Boost/mois', () => {
  assert.deepEqual(grantsDue('or', false), [
    { kind: 'superlike', quantity: 5, period: 'week' },
    { kind: 'boost', quantity: 1, period: 'month' },
  ]);
});

test('grants OFFERT : AUCUN grant récurrent, quel que soit le palier (décision 18/07)', () => {
  // Un palier offert ne reçoit JAMAIS de munitions ni de Boost : Super Like et
  // grille défloutée fabriquent du match gratuit côté homme, et un Boost offert
  // à toutes les femmes ne vaut plus rien. La gratuité = Plus (confort) et point.
  assert.deepEqual(grantsDue('plus', true), []);
  assert.deepEqual(grantsDue('or', true), []);      // défense en profondeur (aucun Or offert n'existe)
  assert.deepEqual(grantsDue('prestige', true), []);
});

test('grants PRESTIGE : Or inclus + 1 Joker/semaine', () => {
  assert.deepEqual(grantsDue('prestige', false), [
    { kind: 'superlike', quantity: 5, period: 'week' },
    { kind: 'boost', quantity: 1, period: 'month' },
    { kind: 'joker', quantity: 1, period: 'week' },
  ]);
});

// ── Clés de période : stables, sans ambiguïté, bords d'année ─────────────────

test('periodKey month : AAAA-MM en UTC', () => {
  assert.equal(periodKey('month', new Date('2026-07-15T23:59:59Z').getTime()), '2026-07');
  assert.equal(periodKey('month', new Date('2026-01-01T00:00:00Z').getTime()), '2026-01');
});

test('periodKey week : semaine ISO 8601 (lundi = début)', () => {
  // Le 15/07/2026 est un mercredi → semaine ISO 29.
  assert.equal(periodKey('week', new Date('2026-07-15T12:00:00Z').getTime()), '2026-W29');
  // Lundi 13/07 et dimanche 19/07 : même semaine.
  assert.equal(periodKey('week', new Date('2026-07-13T00:00:00Z').getTime()), '2026-W29');
  assert.equal(periodKey('week', new Date('2026-07-19T23:59:59Z').getTime()), '2026-W29');
  // Lundi suivant : semaine 30 → un nouveau grant devient dû.
  assert.equal(periodKey('week', new Date('2026-07-20T00:00:00Z').getTime()), '2026-W30');
});

test('periodKey week : bords d\'année ISO (le piège classique)', () => {
  // Le 1er janvier 2027 est un vendredi → il appartient à la semaine 53 de 2026.
  assert.equal(periodKey('week', new Date('2027-01-01T12:00:00Z').getTime()), '2026-W53');
  // Le 4 janvier 2027 (lundi) ouvre la semaine 1 de 2027.
  assert.equal(periodKey('week', new Date('2027-01-04T12:00:00Z').getTime()), '2027-W01');
  // 31 décembre 2024 (mardi) → semaine 1 de 2025 (l'année ISO avance).
  assert.equal(periodKey('week', new Date('2024-12-31T12:00:00Z').getTime()), '2025-W01');
});

test('periodKey : période inconnue → erreur franche (jamais de clé silencieusement fausse)', () => {
  assert.throws(() => periodKey('day', NOW));
});
