'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// adminAuth : jeton de session signé (HMAC) + expiration, et verrouillage
// progressif par IP. Le secret ne doit JAMAIS pouvoir être forgé ni deviné.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  issueToken, verifyToken, registerFailure, registerSuccess, lockState, MAX_FAILS, TTL_MS,
} = require('../../src/services/adminAuth.service');

const SECRET = 'secret-de-test-tres-long-et-aleatoire';
const NOW = 1_700_000_000_000;

test('jeton émis puis vérifié avec le bon secret', () => {
  const t = issueToken(NOW, SECRET);
  assert.equal(verifyToken(t, NOW + 1000, SECRET), true);
});

test('jeton refusé avec un AUTRE secret (signature invalide)', () => {
  const t = issueToken(NOW, SECRET);
  assert.equal(verifyToken(t, NOW + 1000, 'un-autre-secret-de-la-meme-taille!!'), false);
});

test('jeton expiré refusé', () => {
  const t = issueToken(NOW, SECRET);
  assert.equal(verifyToken(t, NOW + TTL_MS + 1, SECRET), false);
});

test('jeton bricolé (payload modifié) refusé', () => {
  const t = issueToken(NOW, SECRET);
  const [, mac] = t.split('.');
  const faux = Buffer.from(JSON.stringify({ exp: NOW + 10 * TTL_MS })).toString('base64url');
  assert.equal(verifyToken(`${faux}.${mac}`, NOW, SECRET), false);
});

test('formes invalides refusées sans exception', () => {
  for (const bad of [null, undefined, '', 'abc', 'a.b.c', 42, {}]) {
    assert.equal(verifyToken(bad, NOW, SECRET), false);
  }
});

test('sans ADMIN_SECRET configuré : aucun jeton émis, aucun accepté', () => {
  assert.equal(issueToken(NOW, ''), null);
  assert.equal(verifyToken('x.y', NOW, ''), false);
});

test('verrouillage après MAX_FAILS échecs, puis libération à l\'expiration', () => {
  const ip = '203.0.113.10';
  for (let i = 0; i < MAX_FAILS - 1; i += 1) {
    assert.equal(registerFailure(ip, NOW).locked, false, 'pas encore verrouillé');
  }
  const st = registerFailure(ip, NOW); // le MAX_FAILS-ième
  assert.equal(st.locked, true);
  assert.ok(st.remainingMs > 0);
  // Une fois le délai passé, l'IP est libre.
  assert.equal(lockState(ip, NOW + st.remainingMs + 1).locked, false);
});

test('récidive : le verrou double', () => {
  const ip = '203.0.113.11';
  for (let i = 0; i < MAX_FAILS; i += 1) registerFailure(ip, NOW);
  const premier = lockState(ip, NOW).remainingMs;
  for (let i = 0; i < MAX_FAILS; i += 1) registerFailure(ip, NOW);
  const second = lockState(ip, NOW).remainingMs;
  assert.ok(second > premier, 'le second verrou doit être plus long');
});

test('un succès efface les échecs en cours', () => {
  const ip = '203.0.113.12';
  registerFailure(ip, NOW);
  registerFailure(ip, NOW);
  registerSuccess(ip);
  // Il faut de nouveau MAX_FAILS échecs complets pour verrouiller.
  for (let i = 0; i < MAX_FAILS - 1; i += 1) {
    assert.equal(registerFailure(ip, NOW).locked, false);
  }
});
