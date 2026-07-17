'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// settings.model — la lecture des réglages à chaud, en CASCADE de sécurité :
//   app_settings (BD)  →  (absent) defaults fournis  →  clamp de bornes.
// Cache mémoire à TTL court : un UPDATE en base se propage en ~60 s sans
// requêter la table à chaque deck. Un réglage manquant ou aberrant NE casse
// JAMAIS le deck (retombe sur le défaut, borné).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSettings } = require('../../src/models/settings.model');

function fakeStore(initial = {}) {
  return {
    calls: 0,
    rows: { ...initial },
    async fetchAll() { this.calls += 1; return { ...this.rows }; },
  };
}

test('valeur présente en base : renvoyée', async () => {
  const store = fakeStore({ 'deck.admirer_ratio': 0.2 });
  const s = createSettings({ store, ttlMs: 1000, now: () => 0 });
  assert.equal(await s.getNumber('deck.admirer_ratio', 0.5), 0.2);
});

test('valeur absente : retombe sur le défaut fourni', async () => {
  const store = fakeStore({});
  const s = createSettings({ store, ttlMs: 1000, now: () => 0 });
  assert.equal(await s.getNumber('deck.admirer_ratio', 0.5), 0.5);
});

test('clamp : une valeur hors bornes est ramenée dans l\'intervalle', async () => {
  const store = fakeStore({ 'deck.admirer_ratio': 9 });
  const s = createSettings({ store, ttlMs: 1000, now: () => 0 });
  assert.equal(await s.getNumber('deck.admirer_ratio', 0.5, { min: 0, max: 1 }), 1);
});

test('valeur non numérique en base : ignorée → défaut (le deck ne casse pas)', async () => {
  const store = fakeStore({ 'deck.admirer_ratio': 'oops' });
  const s = createSettings({ store, ttlMs: 1000, now: () => 0 });
  assert.equal(await s.getNumber('deck.admirer_ratio', 0.5), 0.5);
});

test('cache : plusieurs lectures dans la fenêtre TTL = UN seul fetch', async () => {
  const store = fakeStore({ 'deck.admirer_cap': 6 });
  let t = 0;
  const s = createSettings({ store, ttlMs: 1000, now: () => t });
  await s.getNumber('deck.admirer_cap', 6);
  await s.getNumber('deck.admirer_cap', 6);
  await s.getNumber('deck.admirer_cap', 6);
  assert.equal(store.calls, 1, 'un seul aller-retour DB tant que le cache est chaud');
});

test('cache expiré : re-fetch après le TTL (propagation des UPDATE)', async () => {
  const store = fakeStore({ 'deck.admirer_cap': 6 });
  let t = 0;
  const s = createSettings({ store, ttlMs: 1000, now: () => t });
  await s.getNumber('deck.admirer_cap', 6);
  store.rows['deck.admirer_cap'] = 3; // un UPDATE arrive en base
  t = 1500;                           // au-delà du TTL
  assert.equal(await s.getNumber('deck.admirer_cap', 6), 3, 'la nouvelle valeur est prise en compte');
  assert.equal(store.calls, 2);
});

test('store en panne : fail-soft → défaut, jamais d\'exception qui tue le deck', async () => {
  const store = { async fetchAll() { throw new Error('DB down'); } };
  const s = createSettings({ store, ttlMs: 1000, now: () => 0 });
  assert.equal(await s.getNumber('deck.admirer_ratio', 0.5), 0.5);
});
