'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine RANKING — le score du deck, en code PUR (zéro I/O). La doctrine :
// LA PERTINENCE EST MAÎTRESSE, LE PAYANT AMPLIFIE. Score additif de composants
// normalisés [0,1] pondérés (base ≈ 0–100), puis modificateurs multiplicatifs
// (abonné payé ×1.12, ré-exposition, fairness anti-monopole) + jitter journalier.
// Les rangs payants ①②③ (super-like, Priority, boost) restent dans orderDeck,
// AU-DESSUS du score : promesses produit vendues, jamais diluées dedans.
// Invariant cold-start : agrégats vides = composant engagement NEUTRE (0.5),
// pénalités à ×1 — le deck marche jour 1 sans aucune donnée de sonde.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  freshness, quality, compatibility, newProfile, engagementScore,
  subscriberFactor, reExposureFactor, fairnessFactor,
  scoreCandidate, scoreCandidates, DEFAULT_CONFIG,
} = require('../../src/domain/ranking');

const NOW = Date.parse('2026-07-16T12:00:00Z');
const H = 3600 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

/** Ligne SQL « carte » minimale et VIEILLE (aucun composant parasite). */
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

const baseCtx = (over = {}) => ({
  viewerId: 'viewer-1',
  me: { spoken_languages: [], origin_country: null, current_lat: null, current_lng: null },
  mesInteretsCodes: [],
  likerIds: new Set(),
  engagement: new Map(),
  impressions: new Map(),
  now: NOW,
  // Jitter coupé par défaut : les tests comparent des scores proches.
  config: { jitterAmplitude: 0 },
  ...over,
});

const interests = (...codes) => codes.map((code) => ({ interest: { code } }));

// ── freshness : demi-vie 48 h ────────────────────────────────────────────────

test('freshness : actif à l\'instant = 1, il y a 48 h = 0.5, il y a 96 h = 0.25', () => {
  assert.equal(freshness(iso(0), NOW, 48), 1);
  assert.ok(Math.abs(freshness(iso(48 * H), NOW, 48) - 0.5) < 1e-9);
  assert.ok(Math.abs(freshness(iso(96 * H), NOW, 48) - 0.25) < 1e-9);
});

test('freshness : décroissance monotone, jamais négative, null = 0', () => {
  const f1 = freshness(iso(10 * H), NOW, 48);
  const f2 = freshness(iso(100 * H), NOW, 48);
  const f3 = freshness(iso(5000 * H), NOW, 48);
  assert.ok(f1 > f2 && f2 > f3);
  assert.ok(f3 >= 0);
  assert.equal(freshness(null, NOW, 48), 0, 'jamais actif = aucun signal de vie');
});

// ── quality : complétude du profil ───────────────────────────────────────────

test('quality : profil vide = 0, profil complet = 1', () => {
  assert.equal(quality(row('a')), 0);
  const complet = row('b', {
    photos: [{}, {}, {}, {}],
    bio: 'Une bio soignée qui dépasse largement les quarante caractères requis.',
    prompts: [{ answer: 'oui' }],
    is_verified: true,
  });
  assert.equal(quality(complet), 1);
});

test('quality : chaque critère pèse isolément (photos 2+/4+, bio, prompt, vérifié)', () => {
  assert.ok(Math.abs(quality(row('a', { photos: [{}, {}] })) - 0.3) < 1e-9, '≥2 photos = 0.3');
  assert.ok(Math.abs(quality(row('a', { photos: [{}, {}, {}, {}] })) - 0.4) < 1e-9, '≥4 photos = 0.4');
  assert.ok(Math.abs(quality(row('a', { bio: 'x'.repeat(40) })) - 0.2) < 1e-9, 'bio étoffée = 0.2');
  assert.equal(quality(row('a', { bio: 'courte' })), 0, 'une bio squelettique ne compte pas');
  assert.ok(Math.abs(quality(row('a', { prompts: [{ answer: 'réponse' }] })) - 0.2) < 1e-9);
  assert.ok(Math.abs(quality(row('a', { is_verified: true })) - 0.2) < 1e-9);
});

// ── compatibility : viewer × candidat ────────────────────────────────────────

test('compatibility : rien en commun, pas de coords = seul le neutre distance (0.5 × 0.20)', () => {
  const c = compatibility(row('a'), baseCtx());
  assert.ok(Math.abs(c - 0.10) < 1e-9, 'coords inconnues = composant distance NEUTRE, pas nul');
});

test('compatibility : intérêts plafonnés à 5 (6 partagés = même score que 5)', () => {
  const ctx = baseCtx({ mesInteretsCodes: ['a', 'b', 'c', 'd', 'e', 'f'] });
  const cinq = compatibility(row('x', { interests: interests('a', 'b', 'c', 'd', 'e') }), ctx);
  const six = compatibility(row('x', { interests: interests('a', 'b', 'c', 'd', 'e', 'f') }), ctx);
  assert.equal(cinq, six);
  assert.ok(cinq > compatibility(row('x', { interests: interests('a', 'b') }), ctx));
});

test('compatibility : langues communes plafonnées à 3', () => {
  const ctx = baseCtx({ me: { ...baseCtx().me, spoken_languages: ['fr', 'wo', 'en', 'es'] } });
  const trois = compatibility(row('x', { spoken_languages: ['fr', 'wo', 'en'] }), ctx);
  const quatre = compatibility(row('x', { spoken_languages: ['fr', 'wo', 'en', 'es'] }), ctx);
  assert.equal(trois, quatre);
  assert.ok(trois > compatibility(row('x', { spoken_languages: ['fr'] }), ctx));
});

test('compatibility : même origine compte, origine inconnue d\'un côté ne compte pas', () => {
  const ctxSN = baseCtx({ me: { ...baseCtx().me, origin_country: 'SN' } });
  const meme = compatibility(row('x', { origin_country: 'SN' }), ctxSN);
  const autre = compatibility(row('x', { origin_country: 'CI' }), ctxSN);
  const inconnu = compatibility(row('x'), ctxSN);
  assert.ok(meme > autre);
  assert.equal(autre, inconnu, 'origine différente ou absente : même chose, pas de malus');
});

test('compatibility : la proximité rapproche (0 km > 100 km > 5000 km), et reste bornée', () => {
  const me = { ...baseCtx().me, current_lat: 48.85, current_lng: 2.35 }; // Paris
  const ctx = baseCtx({ me });
  const ici = compatibility(row('x', { current_lat: 48.85, current_lng: 2.35 }), ctx);
  const orleans = compatibility(row('x', { current_lat: 47.9, current_lng: 1.9 }), ctx);
  const dakar = compatibility(row('x', { current_lat: 14.72, current_lng: -17.46 }), ctx);
  assert.ok(ici > orleans && orleans > dakar);
  assert.ok(dakar >= 0);
});

// ── newProfile : le boost des nouvelles têtes (cold start) ───────────────────

test('newProfile : < 48 h = 1, 72 h = mi-pente, ≥ 96 h = 0', () => {
  assert.equal(newProfile(iso(10 * H), NOW, DEFAULT_CONFIG), 1);
  assert.equal(newProfile(iso(48 * H), NOW, DEFAULT_CONFIG), 1);
  assert.ok(Math.abs(newProfile(iso(72 * H), NOW, DEFAULT_CONFIG) - 0.5) < 1e-9);
  assert.equal(newProfile(iso(96 * H), NOW, DEFAULT_CONFIG), 0);
  assert.equal(newProfile(iso(5000 * H), NOW, DEFAULT_CONFIG), 0);
  assert.equal(newProfile(null, NOW, DEFAULT_CONFIG), 0);
});

// ── engagementScore : agrégats des sondes, NEUTRE à froid ────────────────────

const eng = (over = {}) => ({
  impressions: 0, dwellMsTotal: 0, profileOpens: 0, likesReceived: 0, passesReceived: 0, ...over,
});

test('engagement : moins de 20 impressions = 0.5 NEUTRE (2 impressions chanceuses ne trustent pas le deck)', () => {
  assert.equal(engagementScore(undefined, DEFAULT_CONFIG), 0.5, 'jamais mesuré = neutre');
  assert.equal(engagementScore(eng({ impressions: 19, likesReceived: 19 }), DEFAULT_CONFIG), 0.5);
});

test('engagement : dwell moyen, taux d\'ouverture et taux de like pèsent isolément', () => {
  // Dwell moyen 8 s (= plafond) sur 20 impressions, rien d'autre → 0.4.
  const dwell = engagementScore(eng({ impressions: 20, dwellMsTotal: 20 * 8000 }), DEFAULT_CONFIG);
  assert.ok(Math.abs(dwell - 0.4) < 1e-9);
  // Taux d'ouverture au plafond (0.5), rien d'autre → 0.3.
  const opens = engagementScore(eng({ impressions: 20, profileOpens: 10 }), DEFAULT_CONFIG);
  assert.ok(Math.abs(opens - 0.3) < 1e-9);
  // Taux de like au plafond (0.6), rien d'autre → 0.3.
  const likes = engagementScore(eng({ impressions: 20, likesReceived: 12, passesReceived: 8 }), DEFAULT_CONFIG);
  assert.ok(Math.abs(likes - 0.3) < 1e-9);
});

test('engagement : borné [0,1], aucun swipe reçu = pas de division par zéro', () => {
  const max = engagementScore(eng({
    impressions: 100, dwellMsTotal: 100 * 60000, profileOpens: 100, likesReceived: 100,
  }), DEFAULT_CONFIG);
  assert.equal(max, 1);
  const sansSwipe = engagementScore(eng({ impressions: 30 }), DEFAULT_CONFIG);
  assert.ok(sansSwipe >= 0 && sansSwipe <= 1);
});

// ── subscriberFactor : le payant amplifie (jamais l'offert) ──────────────────

test('subscriber : palier PAYÉ actif = ×1.12, expiré ou absent = ×1', () => {
  const futur = new Date(NOW + 30 * 24 * H).toISOString();
  const passe = new Date(NOW - 24 * H).toISOString();
  assert.equal(subscriberFactor(row('a', { premium_tier: 'or', premium_until: futur }), NOW, DEFAULT_CONFIG), 1.12);
  assert.equal(subscriberFactor(row('a', { premium_tier: 'plus', premium_until: futur }), NOW, DEFAULT_CONFIG), 1.12);
  assert.equal(subscriberFactor(row('a', { premium_tier: 'or', premium_until: passe }), NOW, DEFAULT_CONFIG), 1);
  assert.equal(subscriberFactor(row('a'), NOW, DEFAULT_CONFIG), 1);
});

test('subscriber : un palier OFFERT (femme, FREE_TIER_WOMEN) n\'achète JAMAIS de visibilité', () => {
  // Le facteur est résolu freeTierWomen:false : sans tier PAYÉ en base, ×1 —
  // même pour une femme qui jouit de l'Or offert partout ailleurs.
  const femmeOfferte = row('a', { premium_tier: null, premium_until: null, gender: { code: 'woman' } });
  assert.equal(subscriberFactor(femmeOfferte, NOW, DEFAULT_CONFIG), 1);
});

// ── reExposureFactor : la rotation ───────────────────────────────────────────

test('ré-exposition : jamais vu = ×1, 2 vues = ×0.7225, plafonnée à 4 (jamais enterré)', () => {
  assert.equal(reExposureFactor(0, DEFAULT_CONFIG), 1);
  assert.equal(reExposureFactor(undefined, DEFAULT_CONFIG), 1);
  assert.ok(Math.abs(reExposureFactor(2, DEFAULT_CONFIG) - 0.85 ** 2) < 1e-9);
  assert.equal(reExposureFactor(10, DEFAULT_CONFIG), reExposureFactor(4, DEFAULT_CONFIG),
    'au-delà de 4 vues, la pénalité n\'empire plus — la carte doit pouvoir revenir');
});

// ── fairnessFactor : anti-monopole des profils stars ─────────────────────────

test('fairness : très liké ET très vu = ×0.85 ; même taux sur peu d\'impressions = ×1', () => {
  const star = eng({ impressions: 100, likesReceived: 60, passesReceived: 40 }); // 60 % de likes
  assert.equal(fairnessFactor(star, DEFAULT_CONFIG), 0.85);
  const debutant = eng({ impressions: 30, likesReceived: 18, passesReceived: 12 });
  assert.equal(fairnessFactor(debutant, DEFAULT_CONFIG), 1, 'le damping exige un échantillon (≥ 50 impressions)');
  assert.equal(fairnessFactor(undefined, DEFAULT_CONFIG), 1);
});

test('fairness : un taux de like ordinaire (≤ 45 %) ne subit rien', () => {
  const normal = eng({ impressions: 200, likesReceived: 80, passesReceived: 120 }); // 40 %
  assert.equal(fairnessFactor(normal, DEFAULT_CONFIG), 1);
});

// ── scoreCandidate : l'assemblage ────────────────────────────────────────────

test('score : réciprocité — un profil qui m\'a likée passe devant son jumeau qui ne m\'a pas likée', () => {
  const ctx = baseCtx({ likerIds: new Set(['liker']) });
  const sLiker = scoreCandidate(row('liker', { last_active_at: iso(0) }), ctx);
  const sAutre = scoreCandidate(row('autre', { last_active_at: iso(0) }), ctx);
  assert.ok(sLiker > sAutre);
});

test('score : cold start TOTAL (aucune donnée) — le score reste fini, positif, et l\'engagement est neutre', () => {
  const s = scoreCandidate(row('a'), baseCtx());
  assert.ok(Number.isFinite(s));
  // freshness 0 + compat 0.10×30 + engagement 0.5×15 = 3 + 7.5 = 10.5
  assert.ok(Math.abs(s - 10.5) < 1e-6, `attendu 10.5, obtenu ${s}`);
});

test('score : les multiplicateurs s\'appliquent au TOTAL (abonné × rotation × fairness)', () => {
  const futur = new Date(NOW + 30 * 24 * H).toISOString();
  const base = scoreCandidate(row('a', { last_active_at: iso(0) }), baseCtx());
  const ctx = baseCtx({
    impressions: new Map([['a', { seenCount: 2 }]]),
    engagement: new Map([['a', eng({ impressions: 100, likesReceived: 60, passesReceived: 40, dwellMsTotal: 0 })]]),
  });
  const s = scoreCandidate(row('a', { last_active_at: iso(0), premium_tier: 'or', premium_until: futur }), ctx);
  // engagement mesuré (0.3 de likeRate plafonné) remplace le 0.5 neutre :
  const engPart = (0.3 - 0.5) * 15;
  const attendu = (base + engPart) * 1.12 * (0.85 ** 2) * 0.85;
  assert.ok(Math.abs(s - attendu) < 1e-6, `attendu ${attendu}, obtenu ${s}`);
});

// ── scoreCandidates : la Map + le jitter journalier ──────────────────────────

test('scoreCandidates : une entrée par carte, déterministe le même jour pour le même viewer', () => {
  const rows = [row('a', { last_active_at: iso(0) }), row('b')];
  const ctx = baseCtx({ config: {} }); // jitter par défaut ACTIF
  const m1 = scoreCandidates(rows, ctx);
  const m2 = scoreCandidates(rows, ctx);
  assert.equal(m1.size, 2);
  assert.deepEqual([...m1.entries()], [...m2.entries()], 'aucun reshuffle intra-journée');
});

test('scoreCandidates : le jitter est borné (±amplitude) et varie d\'un viewer à l\'autre', () => {
  const r = row('a');
  const base = scoreCandidate(r, baseCtx());
  const j1 = scoreCandidates([r], baseCtx({ config: {} })).get('a') - base;
  const j2 = scoreCandidates([r], baseCtx({ viewerId: 'viewer-2', config: {} })).get('a') - base;
  assert.ok(Math.abs(j1) <= DEFAULT_CONFIG.jitterAmplitude + 1e-9);
  assert.ok(Math.abs(j2) <= DEFAULT_CONFIG.jitterAmplitude + 1e-9);
  assert.notEqual(j1, j2, 'chaque viewer a son propre battement de cartes');
});

test('scoreCandidates : le jitter ne renverse JAMAIS un écart supérieur à 2× son amplitude', () => {
  const fort = row('fort', { last_active_at: iso(0), is_verified: true, photos: [{}, {}] });
  const faible = row('faible');
  for (let v = 0; v < 20; v += 1) {
    const scores = scoreCandidates([fort, faible], baseCtx({ viewerId: `v-${v}`, config: {} }));
    assert.ok(scores.get('fort') > scores.get('faible'),
      'le jitter départage les ex æquo, il ne réécrit pas la pertinence');
  }
});

test('scoreCandidates : la config est surchargeable composant par composant', () => {
  const r = row('a', { last_active_at: iso(0) });
  const sDefaut = scoreCandidates([r], baseCtx()).get('a');
  const sSansFreshness = scoreCandidates([r], baseCtx({
    config: { jitterAmplitude: 0, weights: { ...DEFAULT_CONFIG.weights, freshness: 0 } },
  })).get('a');
  assert.ok(Math.abs((sDefaut - sSansFreshness) - DEFAULT_CONFIG.weights.freshness) < 1e-6);
});

test('pureté : scoreCandidates n\'altère ni les lignes ni le contexte', () => {
  const rows = [row('a'), row('b')];
  const snapshot = JSON.stringify(rows);
  scoreCandidates(rows, baseCtx());
  assert.equal(JSON.stringify(rows), snapshot);
});
