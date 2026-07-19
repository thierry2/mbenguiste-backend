'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// domain/verification — logique pure de la vérification par selfie :
//  • tirage de pose (rng injecté → déterministe) ;
//  • fenêtre de CAPTURE qui expire (start→envoi), REVUE qui n'expire pas ;
//  • transitions légales d'envoi ;
//  • cooldown après rejets répétés.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../src/domain/verification');

// ── Poses ────────────────────────────────────────────────────────────────────

test('pickPose : rng=0 → première pose, rng→1 → dernière', () => {
  assert.equal(V.pickPose(() => 0).code, V.POSES[0].code);
  assert.equal(V.pickPose(() => 0.9999).code, V.POSES[V.POSES.length - 1].code);
});

test('pickPose : chaque code du catalogue est atteignable', () => {
  const n = V.POSES.length;
  const vus = new Set();
  for (let i = 0; i < n; i++) vus.add(V.pickPose(() => (i + 0.5) / n).code);
  assert.equal(vus.size, n);
});

test('poseByCode : retrouve la consigne, null si inconnu', () => {
  assert.equal(V.poseByCode(V.POSES[0].code).instruction, V.POSES[0].instruction);
  assert.equal(V.poseByCode('code_bidon'), null);
});

test('chaque pose a code, instruction et hint non vides', () => {
  for (const p of V.POSES) {
    assert.ok(p.code && p.instruction && p.hint, `pose incomplète : ${JSON.stringify(p)}`);
  }
});

// ── Fenêtre de capture ───────────────────────────────────────────────────────

test('captureExpiryFrom : décale de la fenêtre exacte', () => {
  const start = '2026-07-19T10:00:00.000Z';
  const exp = V.captureExpiryFrom(start);
  assert.equal(new Date(exp).getTime() - new Date(start).getTime(), V.CAPTURE_WINDOW_MS);
});

test('isCaptureExpired : vrai après la fenêtre, faux avant', () => {
  const start = new Date('2026-07-19T10:00:00.000Z');
  const req = { status: 'awaiting_selfie', capture_expires_at: V.captureExpiryFrom(start) };
  const avant = new Date(start.getTime() + V.CAPTURE_WINDOW_MS - 1000);
  const apres = new Date(start.getTime() + V.CAPTURE_WINDOW_MS + 1000);
  assert.equal(V.isCaptureExpired(req, avant), false);
  assert.equal(V.isCaptureExpired(req, apres), true);
});

test('isCaptureExpired : une requête EN REVUE n\'expire jamais (revue = plusieurs jours)', () => {
  const vieux = { status: 'pending_review', capture_expires_at: '2026-07-19T10:00:00.000Z' };
  const dansTroisJours = new Date('2026-07-22T10:00:00.000Z');
  assert.equal(V.isCaptureExpired(vieux, dansTroisJours), false);
});

// ── Transition d'envoi ───────────────────────────────────────────────────────

test('canSubmitSelfie : ok seulement en awaiting_selfie non expiré', () => {
  // Exprimé RELATIVEMENT à la fenêtre, jamais en minutes codées en dur : un
  // écart fixe (« démarré il y a 5 min ») redevient faux dès qu'on ajuste la
  // durée — ce test est tombé pour cette raison au passage de 20 min à 3 min.
  const debut = new Date('2026-07-19T10:00:00.000Z');
  const now = new Date(debut.getTime() + V.CAPTURE_WINDOW_MS / 2); // à mi-fenêtre
  const frais = { status: 'awaiting_selfie', capture_expires_at: V.captureExpiryFrom(debut) };
  assert.deepEqual(V.canSubmitSelfie(frais, now), { ok: true, reason: null });

  assert.equal(V.canSubmitSelfie(null, now).reason, 'no_request');
  assert.equal(V.canSubmitSelfie({ status: 'pending_review' }, now).reason, 'wrong_status');
  assert.equal(V.canSubmitSelfie({ status: 'approved' }, now).reason, 'wrong_status');

  const expire = { status: 'awaiting_selfie', capture_expires_at: '2026-07-19T10:00:00.000Z' };
  assert.equal(V.canSubmitSelfie(expire, now).reason, 'capture_expired');
});

test('isActiveStatus : awaiting_selfie et pending_review occupent la place', () => {
  assert.equal(V.isActiveStatus('awaiting_selfie'), true);
  assert.equal(V.isActiveStatus('pending_review'), true);
  assert.equal(V.isActiveStatus('approved'), false);
  assert.equal(V.isActiveStatus('rejected'), false);
  assert.equal(V.isActiveStatus('expired'), false);
});

// ── Cooldown ─────────────────────────────────────────────────────────────────

test('retryPolicy : sous le seuil d\'essais libres → toujours autorisé', () => {
  const now = new Date('2026-07-19T10:00:00.000Z');
  assert.equal(V.retryPolicy({ attempts: 0, lastRejectedAt: null }, now).canRetry, true);
  assert.equal(V.retryPolicy({ attempts: V.FREE_ATTEMPTS - 1, lastRejectedAt: now.toISOString() }, now).canRetry, true);
});

test('retryPolicy : au seuil et rejet récent → attente, puis ré-autorisé après le cooldown', () => {
  const rejet = new Date('2026-07-19T10:00:00.000Z');
  const bloque = new Date(rejet.getTime() + 1000);
  const p = V.retryPolicy({ attempts: V.FREE_ATTEMPTS, lastRejectedAt: rejet.toISOString() }, bloque);
  assert.equal(p.canRetry, false);
  assert.ok(p.remainingMs > 0);
  assert.equal(new Date(p.retryAt).getTime(), rejet.getTime() + V.COOLDOWN_MS);

  const apres = new Date(rejet.getTime() + V.COOLDOWN_MS + 1000);
  assert.equal(V.retryPolicy({ attempts: V.FREE_ATTEMPTS, lastRejectedAt: rejet.toISOString() }, apres).canRetry, true);
});
