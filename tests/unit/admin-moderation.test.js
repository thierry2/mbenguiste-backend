'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Console de modération — logique PURE de mise en dossiers.
//
// Différence assumée avec la console AfrikMoms (traitement ticket par ticket) :
// dans une app de rencontre, l'unité de décision est la PERSONNE. Trois
// signalements légers de trois femmes différentes valent plus qu'un seul
// signalement grave — c'est le motif récurrent qui révèle un prédateur. Le
// regroupement par profil signalé est donc la donnée de travail, pas un confort.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildDossiers, graviteDe } = require('../../src/services/adminModeration.service');

const profils = new Map([
  ['p1', { id: 'p1', prenom: 'Karim', avatarUrl: null, estRetire: false }],
  ['p2', { id: 'p2', prenom: 'Momo', avatarUrl: null, estRetire: false }],
  ['p3', { id: 'p3', prenom: 'Ali', avatarUrl: null, estRetire: true }],
]);

const r = (id, reported, reporter, code, createdAt) => ({
  id, reported_id: reported, reporter_id: reporter,
  reason_code: code, reason_label: code, details: null,
  status: 'open', created_at: createdAt,
});

test('gravité : mineur et menaces passent avant tout le reste', () => {
  assert.equal(graviteDe(['underage']), 'critique');
  assert.equal(graviteDe(['threats']), 'critique');
  assert.equal(graviteDe(['scam', 'underage']), 'critique'); // le pire l'emporte
});

test('gravité : rencontre en personne, arnaque, haine, harcèlement = élevée', () => {
  for (const code of ['offline_behavior', 'scam', 'hate', 'harassment']) {
    assert.equal(graviteDe([code]), 'eleve');
  }
});

test('gravité : le reste est standard', () => {
  assert.equal(graviteDe(['other']), 'standard');
  assert.equal(graviteDe([]), 'standard');
});

test('un dossier par personne signalée, pas un par ticket', () => {
  const rows = [
    r('r1', 'p1', 'a', 'scam', '2026-07-10T10:00:00Z'),
    r('r2', 'p1', 'b', 'scam', '2026-07-12T10:00:00Z'),
  ];
  const out = buildDossiers(rows, profils);
  assert.equal(out.length, 1);
  assert.equal(out[0].profileId, 'p1');
  assert.equal(out[0].signalements.length, 2);
});

test('compte les signalants DISTINCTS, pas les tickets', () => {
  const rows = [
    r('r1', 'p1', 'a', 'scam', '2026-07-10T10:00:00Z'),
    r('r2', 'p1', 'a', 'harassment', '2026-07-11T10:00:00Z'), // même signalante
    r('r3', 'p1', 'b', 'scam', '2026-07-12T10:00:00Z'),
  ];
  assert.equal(buildDossiers(rows, profils)[0].signalants, 2);
});

test('les motifs sont agrégés avec leur nombre, du plus fréquent au moins', () => {
  const rows = [
    r('r1', 'p1', 'a', 'scam', '2026-07-10T10:00:00Z'),
    r('r2', 'p1', 'b', 'scam', '2026-07-11T10:00:00Z'),
    r('r3', 'p1', 'c', 'hate', '2026-07-12T10:00:00Z'),
  ];
  assert.deepEqual(
    buildDossiers(rows, profils)[0].motifs.map((m) => [m.code, m.nombre]),
    [['scam', 2], ['hate', 1]],
  );
});

test('tri : la gravité d\'abord, puis le nombre de signalantes, puis la fraîcheur', () => {
  const rows = [
    // p1 : standard mais 2 signalantes
    r('r1', 'p1', 'a', 'other', '2026-07-10T10:00:00Z'),
    r('r2', 'p1', 'b', 'other', '2026-07-11T10:00:00Z'),
    // p2 : critique, 1 seule signalante → doit passer devant
    r('r3', 'p2', 'c', 'underage', '2026-07-09T10:00:00Z'),
  ];
  assert.deepEqual(buildDossiers(rows, profils).map((d) => d.profileId), ['p2', 'p1']);
});

test('à gravité égale, plus de signalantes passe devant', () => {
  const rows = [
    r('r1', 'p1', 'a', 'scam', '2026-07-10T10:00:00Z'),
    r('r2', 'p2', 'b', 'scam', '2026-07-11T10:00:00Z'),
    r('r3', 'p2', 'c', 'scam', '2026-07-12T10:00:00Z'),
  ];
  assert.deepEqual(buildDossiers(rows, profils).map((d) => d.profileId), ['p2', 'p1']);
});

test('le dossier porte la date du signalement le plus RÉCENT', () => {
  const rows = [
    r('r1', 'p1', 'a', 'scam', '2026-07-10T10:00:00Z'),
    r('r2', 'p1', 'b', 'scam', '2026-07-14T10:00:00Z'),
  ];
  assert.equal(buildDossiers(rows, profils)[0].dernierLe, '2026-07-14T10:00:00Z');
});

test('le dossier dit si le profil est DÉJÀ retiré (retrait auto au seuil)', () => {
  const rows = [r('r1', 'p3', 'a', 'scam', '2026-07-10T10:00:00Z')];
  assert.equal(buildDossiers(rows, profils)[0].dejaRetire, true);
});

test('un profil supprimé entre-temps ne fait pas tomber la console', () => {
  const rows = [r('r1', 'inconnu', 'a', 'scam', '2026-07-10T10:00:00Z')];
  const out = buildDossiers(rows, profils);
  assert.equal(out.length, 1);
  assert.equal(out[0].prenom, 'Compte supprimé');
});

test('aucun signalement → aucun dossier (pas de plantage sur liste vide)', () => {
  assert.deepEqual(buildDossiers([], profils), []);
});
