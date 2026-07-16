'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine COUPS DE CŒUR — la sélection du jour (docs/doctrine-offres.md).
// « ~10 profils choisis POUR toi, purement algorithmiques (compatibilité :
// intérêts, langues, bio) — JAMAIS nourrie par les admirateurs. » Éphémère :
// stable sur 24 h (un seed par jour), puis renouvelée. Fonction PURE, testable.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compatibilityScore, selectDailyPicks, picksDaySeed } = require('../../src/domain/picks');

const prof = (id, { interets = [], langues = [], bio = null, estVerifie = false, photos = [] } = {}) => ({
  id,
  interets: interets.map((code) => ({ code })),
  langues, bio, estVerifie, photos,
});

// ── Score de compatibilité ─────────────────────────────────────────────────────

test('intérêts partagés : plus il y en a, plus le score monte', async () => {
  const viewer = prof('me', { interets: ['rando', 'ciné', 'cuisine'] });
  const peu = prof('a', { interets: ['rando'] });
  const bcp = prof('b', { interets: ['rando', 'ciné', 'cuisine'] });
  assert.ok(compatibilityScore(viewer, bcp) > compatibilityScore(viewer, peu));
});

test('langues en commun : comptent dans le score', async () => {
  const viewer = prof('me', { langues: ['fr', 'wo'] });
  const zero = prof('a', { langues: ['en'] });
  const deux = prof('b', { langues: ['fr', 'wo'] });
  assert.ok(compatibilityScore(viewer, deux) > compatibilityScore(viewer, zero));
});

test('bio, vérification et 2+ photos ajoutent des points (qualité de profil)', async () => {
  const viewer = prof('me');
  const nu = prof('a');
  const riche = prof('b', { bio: 'Passionnée de voyage', estVerifie: true, photos: [1, 2] });
  assert.ok(compatibilityScore(viewer, riche) > compatibilityScore(viewer, nu));
});

test('une bio vide (espaces) ne compte pas', async () => {
  const viewer = prof('me');
  assert.equal(compatibilityScore(viewer, prof('a', { bio: '   ' })), compatibilityScore(viewer, prof('a')));
});

// ── Sélection quotidienne ──────────────────────────────────────────────────────

test('sélection : rend au plus `count` profils, les plus compatibles d\'abord', async () => {
  const viewer = prof('me', { interets: ['rando', 'ciné'] });
  const cands = [
    prof('faible', {}),
    prof('fort', { interets: ['rando', 'ciné'], bio: 'x', estVerifie: true }),
    prof('moyen', { interets: ['rando'] }),
  ];
  const out = selectDailyPicks(cands, viewer, { count: 2, daySeed: '2026-07-15' });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'fort', 'le plus compatible en tête');
});

test('moins de candidats que `count` : rend tout le monde', async () => {
  const out = selectDailyPicks([prof('a'), prof('b')], prof('me'), { count: 10, daySeed: 'd' });
  assert.equal(out.length, 2);
});

test('stable sur un même jour, varie d\'un jour à l\'autre (à compatibilité égale)', async () => {
  const viewer = prof('me');
  const cands = ['a', 'b', 'c', 'd', 'e'].map((id) => prof(id)); // tous score de base égal
  const jour1a = selectDailyPicks(cands, viewer, { count: 5, daySeed: 'J1' }).map((c) => c.id);
  const jour1b = selectDailyPicks(cands, viewer, { count: 5, daySeed: 'J1' }).map((c) => c.id);
  const jour2 = selectDailyPicks(cands, viewer, { count: 5, daySeed: 'J2' }).map((c) => c.id);
  assert.deepEqual(jour1a, jour1b, 'même jour = même ordre (éphémère mais stable 24 h)');
  assert.notDeepEqual(jour1a, jour2, 'un autre jour rebat les cartes');
});

test('picksDaySeed : un seau UTC par jour (24 h)', async () => {
  const matin = picksDaySeed(Date.parse('2026-07-15T06:00:00Z'));
  const soir = picksDaySeed(Date.parse('2026-07-15T22:00:00Z'));
  const lendemain = picksDaySeed(Date.parse('2026-07-16T06:00:00Z'));
  assert.equal(matin, soir, 'même jour → même seed');
  assert.notEqual(matin, lendemain);
});

test('sélection : n\'altère pas la liste source (pure)', async () => {
  const cands = [prof('a'), prof('b')];
  const snap = JSON.stringify(cands);
  selectDailyPicks(cands, prof('me'), { daySeed: 'd' });
  assert.equal(JSON.stringify(cands), snap);
});
