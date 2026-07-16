'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine DECK — l'ordre de la pile de découverte (docs/doctrine-offres.md).
// Le Super Like traverse le paywall PAR LE DECK (tranché le 15/07) : la carte de
// qui m'a super-likée remonte en tête et porte une marque `superLikedMe`, même
// si je suis gratuite. Priorités, de la plus forte à la plus faible :
//   ① super-like reçu (marqué)      ② Priority Like d'un Prestige (marqué)
//   ③ profil boosté                 ④ score de pertinence (domaine ranking)
//   ⑤ ordre d'entrée conservé (tri stable).
// Un signal DIRIGÉ vers moi (super-like, Priority Like) prime sur un Boost, qui
// n'est qu'une mise en avant générique achetée. Les rangs ①②③ sont des
// promesses produit VENDUES : aucun score, si haut soit-il, ne les dépasse.
// Fonction PURE (zéro I/O) → testable exhaustivement.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orderDeck } = require('../../src/domain/deck');

const card = (id, extra = {}) => ({ id, ...extra });

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

// ── Priority Likes (Prestige, Lot F) ─────────────────────────────────────────

test('Priority Like (Prestige) : passe devant un boosté, mais DERRIÈRE un super-like', async () => {
  const cards = [card('normal'), card('boosted'), card('priority'), card('superliker')];
  const out = orderDeck(cards, {
    superLikerIds: new Set(['superliker']),
    priorityLikerIds: new Set(['priority']),
    boostedIds: new Set(['boosted']),
  });
  assert.deepEqual(out.map((c) => c.id), ['superliker', 'priority', 'boosted', 'normal']);
});

test('marquage : le Priority Like porte priorityLikedMe=true', async () => {
  const out = orderDeck([card('a'), card('p')], { priorityLikerIds: new Set(['p']) });
  assert.equal(out.find((c) => c.id === 'p').priorityLikedMe, true);
  assert.equal(out.find((c) => c.id === 'a').priorityLikedMe, false);
});

test('un super-likeur QUI EST AUSSI Prestige : reste au rang super-like (pas de double compte)', async () => {
  const out = orderDeck([card('autre'), card('both')], {
    superLikerIds: new Set(['both']),
    priorityLikerIds: new Set(['both']),
  });
  assert.equal(out[0].id, 'both');
  assert.equal(out[0].superLikedMe, true);
  assert.equal(out[0].priorityLikedMe, true);
});

// ── Le score de pertinence (rang ④, domaine ranking) ─────────────────────────

test('sous les rangs payés : tri par score décroissant', async () => {
  const cards = [card('tiede'), card('brulant'), card('froid')];
  const out = orderDeck(cards, {
    scores: new Map([['tiede', 42], ['brulant', 88], ['froid', 7]]),
  });
  assert.deepEqual(out.map((c) => c.id), ['brulant', 'tiede', 'froid']);
});

test('AUCUN score ne dépasse un rang payé : un super-likeur à score nul reste en tête', async () => {
  const cards = [card('parfait'), card('superliker'), card('boosted')];
  const out = orderDeck(cards, {
    superLikerIds: new Set(['superliker']),
    boostedIds: new Set(['boosted']),
    scores: new Map([['parfait', 9999], ['superliker', 0], ['boosted', 1]]),
  });
  assert.deepEqual(out.map((c) => c.id), ['superliker', 'boosted', 'parfait'],
    'les rangs ①②③ sont des promesses vendues, jamais diluées dans le score');
});

test('au sein d\'un MÊME rang payé : le score départage (deux boostés)', async () => {
  const cards = [card('boost-faible'), card('boost-fort')];
  const out = orderDeck(cards, {
    boostedIds: new Set(['boost-faible', 'boost-fort']),
    scores: new Map([['boost-faible', 10], ['boost-fort', 90]]),
  });
  assert.deepEqual(out.map((c) => c.id), ['boost-fort', 'boost-faible']);
});

test('sans scores (Map absente ou vide) : l\'ordre d\'entrée est conservé — dégradation douce', async () => {
  const cards = [card('a'), card('b'), card('c')];
  assert.deepEqual(orderDeck(cards, {}).map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(orderDeck(cards, { scores: new Map() }).map((c) => c.id), ['a', 'b', 'c']);
});

test('carte sans entrée dans la Map : score 0, se range derrière les scorées', async () => {
  const cards = [card('inconnu'), card('scoré')];
  const out = orderDeck(cards, { scores: new Map([['scoré', 5]]) });
  assert.deepEqual(out.map((c) => c.id), ['scoré', 'inconnu']);
});

test('à scores égaux : l\'ordre d\'entrée est conservé (tri stable)', async () => {
  const cards = [card('a'), card('b'), card('c')];
  const out = orderDeck(cards, { scores: new Map([['a', 5], ['b', 5], ['c', 5]]) });
  assert.deepEqual(out.map((c) => c.id), ['a', 'b', 'c']);
});

test('n\'altère pas la liste d\'entrée (pure)', async () => {
  const cards = [card('a'), card('b')];
  const snapshot = JSON.stringify(cards);
  orderDeck(cards, { superLikerIds: new Set(['b']) });
  assert.equal(JSON.stringify(cards), snapshot, 'la liste source reste intacte');
});
