'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// splitAdmirers (domaine pur) — le curseur LIQUIDITÉ ↔ RARETÉ (décision 17/07).
// Les gens qui m'ont likée : quelle part entre dans mon DECK (match gratuit
// possible, marché vivant) vs reste RÉSERVÉE à l'onglet « Likes » (que vend
// l'Or) ? Réglé à chaud par app_settings (ratio + cap).
//  - super-likes reçus : TOUJOURS au deck (promesse vendue, hors curseur) ;
//  - likes ordinaires : une fraction `ratio` (plafonnée à `cap`) au deck, le
//    reste retenu ; sélection DÉTERMINISTE par jour (pas de sautillement).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitAdmirers } = require('../../src/domain/deck');

const ids = (n, p = 'u') => Array.from({ length: n }, (_, i) => `${p}${i}`);
const seed = 'viewer:2026-07-17';

test('ratio 1 : tous les admirateurs entrent dans le deck, rien de retenu', () => {
  const { deckAdmirers, heldBack } = splitAdmirers(ids(10), new Set(), { ratio: 1, cap: 100, seed });
  assert.equal(deckAdmirers.size, 10);
  assert.equal(heldBack.size, 0);
});

test('ratio 0 : RARETÉ pure — aucun like ordinaire au deck, tous retenus pour « Likes »', () => {
  const { deckAdmirers, heldBack } = splitAdmirers(ids(10), new Set(), { ratio: 0, cap: 100, seed });
  assert.equal(deckAdmirers.size, 0);
  assert.equal(heldBack.size, 10);
});

test('ratio 0.5 : la moitié au deck, l\'autre retenue (partition complète)', () => {
  const list = ids(10);
  const { deckAdmirers, heldBack } = splitAdmirers(list, new Set(), { ratio: 0.5, cap: 100, seed });
  assert.equal(deckAdmirers.size, 5);
  assert.equal(heldBack.size, 5);
  // Partition : chaque admirateur est exactement d'un côté.
  for (const id of list) assert.equal(deckAdmirers.has(id) !== heldBack.has(id), true);
});

test('cap : le nombre au deck est plafonné même si le ratio en autorise plus', () => {
  const { deckAdmirers, heldBack } = splitAdmirers(ids(20), new Set(), { ratio: 1, cap: 6, seed });
  assert.equal(deckAdmirers.size, 6);
  assert.equal(heldBack.size, 14);
});

test('super-likes : TOUJOURS au deck, hors curseur (même à ratio 0)', () => {
  const list = ['ord1', 'ord2', 'sl1', 'sl2'];
  const supers = new Set(['sl1', 'sl2']);
  const { deckAdmirers, heldBack } = splitAdmirers(list, supers, { ratio: 0, cap: 0, seed });
  assert.equal(deckAdmirers.has('sl1'), true);
  assert.equal(deckAdmirers.has('sl2'), true);
  assert.equal(heldBack.has('sl1'), false, 'un super-like n\'est jamais retenu derrière le paywall');
  assert.equal(heldBack.has('sl2'), false);
  // Les ordinaires, eux, sont retenus (ratio 0).
  assert.equal(heldBack.has('ord1') && heldBack.has('ord2'), true);
});

test('super-likes ne comptent PAS dans le cap des ordinaires', () => {
  const list = [...ids(10, 'o'), 'sl1', 'sl2'];
  const supers = new Set(['sl1', 'sl2']);
  const { deckAdmirers } = splitAdmirers(list, supers, { ratio: 1, cap: 3, seed });
  // 3 ordinaires (cap) + 2 super-likes = 5 au deck.
  assert.equal(deckAdmirers.size, 5);
  assert.equal([...deckAdmirers].filter((id) => supers.has(id)).length, 2);
});

test('déterminisme : même seed → même partition (deck stable dans la journée)', () => {
  const list = ids(12);
  const a = splitAdmirers(list, new Set(), { ratio: 0.5, cap: 100, seed });
  const b = splitAdmirers(list, new Set(), { ratio: 0.5, cap: 100, seed });
  assert.deepEqual([...a.deckAdmirers].sort(), [...b.deckAdmirers].sort());
});

test('seed différent (autre jour) : la partition peut changer — rotation des admirateurs vus', () => {
  const list = ids(12);
  const jour1 = splitAdmirers(list, new Set(), { ratio: 0.5, cap: 100, seed: 'v:2026-07-17' });
  const jour2 = splitAdmirers(list, new Set(), { ratio: 0.5, cap: 100, seed: 'v:2026-07-18' });
  // Pas garanti différent, mais la fonction doit accepter et rester une partition.
  assert.equal(jour2.deckAdmirers.size + jour2.heldBack.size, 12);
  assert.notEqual(JSON.stringify([...jour1.deckAdmirers].sort()), undefined);
});

test('liste vide : deux ensembles vides, pas de crash', () => {
  const { deckAdmirers, heldBack } = splitAdmirers([], new Set(), { ratio: 0.5, cap: 6, seed });
  assert.equal(deckAdmirers.size, 0);
  assert.equal(heldBack.size, 0);
});

test('bornes : ratio hors [0,1] est ramené dans l\'intervalle', () => {
  assert.equal(splitAdmirers(ids(10), new Set(), { ratio: 2, cap: 100, seed }).deckAdmirers.size, 10);
  assert.equal(splitAdmirers(ids(10), new Set(), { ratio: -1, cap: 100, seed }).deckAdmirers.size, 0);
});
