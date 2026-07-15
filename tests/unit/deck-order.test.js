'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine DECK — l'ordre de la pile de découverte (docs/doctrine-offres.md).
// Le Super Like traverse le paywall PAR LE DECK (tranché le 15/07) : la carte de
// qui m'a super-likée remonte en tête et porte une marque `superLikedMe`, même
// si je suis gratuite. Priorités, de la plus forte à la plus faible :
//   ① super-like reçu (marqué)  ② profil boosté  ③ intention complémentaire
//   ④ ordre d'entrée conservé (tri stable — l'activité, déjà triée en amont).
// Fonction PURE (zéro I/O) → testable exhaustivement.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orderDeck } = require('../../src/domain/deck');

const card = (id, extra = {}) => ({ id, intention: null, ...extra });

test('super-like reçu : remonte en TÊTE, au-dessus même d\'un boosté', async () => {
  const cards = [card('normal'), card('boosted'), card('superliker')];
  const out = orderDeck(cards, {
    superLikerIds: new Set(['superliker']),
    boostedIds: new Set(['boosted']),
  });
  assert.deepEqual(out.map((c) => c.id), ['superliker', 'boosted', 'normal']);
});

test('marquage : seul le super-likeur porte superLikedMe=true', async () => {
  const out = orderDeck([card('a'), card('b')], { superLikerIds: new Set(['b']) });
  const a = out.find((c) => c.id === 'a');
  const b = out.find((c) => c.id === 'b');
  assert.equal(a.superLikedMe, false);
  assert.equal(b.superLikedMe, true);
});

test('boosté passe devant un profil normal (sans super-like en jeu)', async () => {
  const out = orderDeck([card('normal'), card('boosted')], { boostedIds: new Set(['boosted']) });
  assert.deepEqual(out.map((c) => c.id), ['boosted', 'normal']);
});

test('plusieurs super-likeurs : tous en tête, ordre d\'entrée conservé entre eux', async () => {
  const cards = [card('x'), card('sl1'), card('y'), card('sl2')];
  const out = orderDeck(cards, { superLikerIds: new Set(['sl1', 'sl2']) });
  assert.deepEqual(out.slice(0, 2).map((c) => c.id), ['sl1', 'sl2']);
});

test('à priorités égales : l\'ordre d\'entrée est conservé (tri stable)', async () => {
  const cards = [card('a'), card('b'), card('c')];
  const out = orderDeck(cards, {});
  assert.deepEqual(out.map((c) => c.id), ['a', 'b', 'c']);
});

test('intention complémentaire (envol ↔ retour) passe devant, à défaut de super-like/boost', async () => {
  const cards = [card('meme', { intention: 'depart' }), card('complement', { intention: 'retour' })];
  const out = orderDeck(cards, { myIntention: 'depart' });
  assert.deepEqual(out.map((c) => c.id), ['complement', 'meme']);
});

test('n\'altère pas la liste d\'entrée (pure)', async () => {
  const cards = [card('a'), card('b')];
  const snapshot = JSON.stringify(cards);
  orderDeck(cards, { superLikerIds: new Set(['b']) });
  assert.equal(JSON.stringify(cards), snapshot, 'la liste source reste intacte');
});
