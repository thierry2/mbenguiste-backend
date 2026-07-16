'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Le PIPELINE du deck — scoreCandidates (domaine ranking) composé avec
// orderDeck (domaine deck), exactement comme discovery.model.candidates les
// enchaîne. On vérifie ici les COMPORTEMENTS de bout en bout :
//  - à froid (zéro donnée de sonde), le deck est ordonné par pertinence pure ;
//  - la rotation fait redescendre les cartes déjà montrées sans swipe ;
//  - l'engagement mesuré (sondes) fait remonter les profils qui captivent ;
//  - la monétisation : rangs durs ①②③ intouchables, abonné payé amplifié.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreCandidates } = require('../../src/domain/ranking');
const { orderDeck } = require('../../src/domain/deck');

const NOW = Date.parse('2026-07-16T12:00:00Z');
const H = 3600 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const row = (id, extra = {}) => ({
  id,
  last_active_at: null,
  created_at: '2026-01-01T00:00:00Z',
  bio: null,
  is_verified: false,
  photos: [],
  prompts: [],
  interests: [],
  spoken_languages: [],
  origin_country: null,
  current_lat: null,
  current_lng: null,
  premium_tier: null,
  premium_until: null,
  ...extra,
});

const ctx = (over = {}) => ({
  viewerId: 'moi',
  me: { spoken_languages: ['fr'], origin_country: 'SN', current_lat: null, current_lng: null },
  mesInteretsCodes: ['cuisine', 'voyage'],
  likerIds: new Set(),
  engagement: new Map(),
  impressions: new Map(),
  now: NOW,
  config: { jitterAmplitude: 0 }, // départages déterministes pour les tests
  ...over,
});

/** Le pipeline tel que discovery.model l'exécute : scorer puis ordonner. */
function buildDeck(rows, context, ranks = {}) {
  const scores = scoreCandidates(rows, context);
  return orderDeck(rows, { ...ranks, scores }).map((c) => c.id);
}

test('à froid (aucune sonde) : le deck est ordonné par pertinence pure — actif+compatible devant', () => {
  const rows = [
    row('fantome'), // jamais actif, rien en commun
    row('compatible', {
      last_active_at: iso(2 * H),
      interests: [{ interest: { code: 'cuisine' } }, { interest: { code: 'voyage' } }],
      spoken_languages: ['fr'],
      origin_country: 'SN',
      photos: [{}, {}],
      bio: 'Une bio de plus de quarante caractères pour compter dans la qualité.',
    }),
    row('actif-vide', { last_active_at: iso(2 * H) }), // frais mais profil désert
  ];
  const deck = buildDeck(rows, ctx());
  assert.deepEqual(deck, ['compatible', 'actif-vide', 'fantome']);
});

test('rotation : à profil égal, la carte déjà montrée 3 fois sans swipe redescend', () => {
  const rows = [row('deja-vu', { last_active_at: iso(H) }), row('inedit', { last_active_at: iso(H) })];
  const deck = buildDeck(rows, ctx({
    impressions: new Map([['deja-vu', { seenCount: 3 }]]),
  }));
  assert.deepEqual(deck, ['inedit', 'deja-vu'], 'le deck reste vivant : du neuf d\'abord');
});

test('engagement mesuré : le profil qui captive (dwell fort, ouvertures) passe son jumeau neutre', () => {
  const rows = [row('neutre', { last_active_at: iso(H) }), row('captivant', { last_active_at: iso(H) })];
  const deck = buildDeck(rows, ctx({
    engagement: new Map([
      // 40 impressions, 7 s de dwell moyen, 40 % d'ouvertures de profil, 50 % de likes.
      ['captivant', { impressions: 40, dwellMsTotal: 40 * 7000, profileOpens: 16, likesReceived: 10, passesReceived: 10 }],
    ]),
  }));
  assert.deepEqual(deck, ['captivant', 'neutre'],
    'les sondes nourrissent le rang : mieux que le 0.5 neutre du jamais-mesuré');
});

test('monétisation : un boosté au profil faible passe devant un non-boosté parfait', () => {
  const rows = [
    row('parfait', {
      last_active_at: iso(0), is_verified: true, photos: [{}, {}, {}, {}],
      interests: [{ interest: { code: 'cuisine' } }], spoken_languages: ['fr'], origin_country: 'SN',
    }),
    row('booste-faible'),
  ];
  const deck = buildDeck(rows, ctx(), { boostedIds: new Set(['booste-faible']) });
  assert.deepEqual(deck, ['booste-faible', 'parfait'], 'le Boost est une promesse vendue : 30 min EN TÊTE');
});

test('monétisation : le super-likeur reste rang ① même usé par la rotation', () => {
  const rows = [row('frais', { last_active_at: iso(0) }), row('superliker')];
  const deck = buildDeck(rows, ctx({
    impressions: new Map([['superliker', { seenCount: 10 }]]),
  }), { superLikerIds: new Set(['superliker']) });
  assert.deepEqual(deck, ['superliker', 'frais'],
    'la rotation ne mange jamais une promesse vendue');
});

test('monétisation : l\'abonné PAYÉ actif passe son jumeau gratuit — l\'expiré non', () => {
  const futur = new Date(NOW + 30 * 24 * H).toISOString();
  const passe = new Date(NOW - 24 * H).toISOString();
  const jumeau = { last_active_at: iso(H), photos: [{}, {}] };
  const rows = [
    row('gratuit', jumeau),
    row('abonne', { ...jumeau, premium_tier: 'or', premium_until: futur }),
    row('expire', { ...jumeau, premium_tier: 'prestige', premium_until: passe }),
  ];
  const deck = buildDeck(rows, ctx());
  assert.equal(deck[0], 'abonne', 'le léger multiplicateur d\'abonné joue à pertinence égale');
  assert.deepEqual(deck.slice(1).sort(), ['expire', 'gratuit'].sort(), 'un abonnement échu ne paie plus rien');
});

test('le nouveau profil (< 48 h) reçoit sa fenêtre de visibilité face à un ancien identique', () => {
  const jumeau = { last_active_at: iso(H) };
  const rows = [
    row('ancien', { ...jumeau, created_at: '2026-01-01T00:00:00Z' }),
    row('nouveau', { ...jumeau, created_at: iso(12 * H) }),
  ];
  const deck = buildDeck(rows, ctx());
  assert.deepEqual(deck, ['nouveau', 'ancien'], 'cold start produit : les nouvelles têtes existent tout de suite');
});
