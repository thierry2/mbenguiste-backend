'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION D'UN GRAPHE édité (console admin). Un graphe cassé figerait une
// aventure en cours : on le refuse AVANT d'écrire. On fige ici ce qui doit
// passer et ce qui doit être rejeté.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validerGraphe } = require('../../src/domain/aventure');
const { GROTTE } = require('../../src/domain/aventureGraphe');

test('le graphe en dur (la grotte) est valide', () => {
  assert.deepEqual(validerGraphe(GROTTE), []);
});

test('start absent des nœuds → signalé', () => {
  const g = { start: 'nowhere', nodes: { n1: { kind: 'end', end: 'match' } } };
  assert.ok(validerGraphe(g).join(' ').includes('nowhere'));
});

test('une flèche vers un nœud inexistant → signalée (aventure figée sinon)', () => {
  const g = {
    start: 'n1',
    nodes: {
      n1: { kind: 'epreuve', accord: { survie: { next: 'fantome' }, mort: { next: 'fin' } }, desaccord: { mort: 'fin' } },
      fin: { kind: 'end', end: 'echec' },
    },
  };
  assert.ok(validerGraphe(g).join(' ').includes('fantome'));
});

test('cibles oui/non (consentement) et desaccord.mort sont vérifiées', () => {
  const g = {
    start: 'c',
    nodes: {
      c: { kind: 'consentement', oui: 'absent', non: 'stop' },
      stop: { kind: 'end', end: 'left' },
    },
  };
  assert.ok(validerGraphe(g).join(' ').includes('absent'));
});

test('vide / sans nœuds → refusé proprement, jamais un crash', () => {
  assert.deepEqual(validerGraphe(null), ['graphe vide']);
  assert.deepEqual(validerGraphe({}), ['aucun nœud']);
});
