'use strict';
// Mise en forme PURE de l'état de vérification (verification.service.buildStatus) :
// c'est elle qui décide quel écran mobile s'affiche. Aucune I/O — les entrées
// sont les lignes brutes de `verification_requests` et du profil.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStatus, buildQueueItem } = require('../../src/services/verification.service');
const { POSES, CAPTURE_WINDOW_MS, FREE_ATTEMPTS, COOLDOWN_MS } = require('../../src/domain/verification');

const NOW = new Date('2026-07-19T12:00:00Z');
const ME = '00000000-0000-0000-0000-00000000000a';

const iso = (ms) => new Date(NOW.getTime() + ms).toISOString();

const request = (over = {}) => ({
  id: 'req-1',
  user_id: ME,
  pose_code: POSES[0].code,
  status: 'awaiting_selfie',
  attempt_no: 1,
  capture_expires_at: iso(CAPTURE_WINDOW_MS),
  submitted_at: null,
  rejection_reason: null,
  ...over,
});

const empty = { attempts: 0, lastRejectedAt: null };
// La plupart des cas supposent un profil qui a déjà des photos : sans elles, la
// vérification n'a rien à comparer et court-circuite tout (cf. test dédié).
const AVEC_PHOTOS = 3;

test('profil vierge → idle, peut démarrer', () => {
  const out = buildStatus({ profile: { is_verified: false }, request: null, last: null, history: empty, photoCount: AVEC_PHOTOS }, NOW);
  assert.equal(out.state, 'idle');
  assert.equal(out.canStart, true);
  assert.equal(out.pose, null);
});

test('AUCUNE photo de profil → no_photos, démarrage interdit', () => {
  // Sans photo il n'y a rien à comparer : laisser démarrer enverrait quelqu'un
  // se photographier pour un refus joué d'avance, et polluerait la file.
  const out = buildStatus({ profile: { is_verified: false }, request: null, last: null, history: empty, photoCount: 0 }, NOW);
  assert.equal(out.state, 'no_photos');
  assert.equal(out.canStart, false);
});

test('sans photo mais DÉJÀ vérifiée → le sceau prime, pas de régression', () => {
  const out = buildStatus({ profile: { is_verified: true, verified_at: '2026-07-10T09:00:00Z' }, request: null, last: null, history: empty, photoCount: 0 }, NOW);
  assert.equal(out.state, 'verified');
});

test('sans photo mais capture DÉJÀ en cours → on laisse aller au bout', () => {
  // Photos supprimées après le démarrage : plutôt que de figer un état
  // incompréhensible, on laisse la demande vivre — la revue humaine tranchera.
  const r = request();
  const out = buildStatus({ profile: { is_verified: false }, request: r, last: r, history: empty, photoCount: 0 }, NOW);
  assert.equal(out.state, 'capturing');
});

test('capture en cours → capturing, avec la pose imposée et son échéance', () => {
  const r = request();
  const out = buildStatus({ profile: { is_verified: false }, request: r, last: r, history: empty, photoCount: AVEC_PHOTOS }, NOW);
  assert.equal(out.state, 'capturing');
  assert.equal(out.requestId, 'req-1');
  assert.equal(out.pose.code, POSES[0].code);
  assert.equal(out.captureExpiresAt, r.capture_expires_at);
  // Tant qu'une capture est ouverte, pas de second démarrage (sinon la roue tourne).
  assert.equal(out.canStart, false);
});

test('fenêtre de capture écoulée → retour à idle (nouvelle pose au prochain start)', () => {
  const r = request({ capture_expires_at: iso(-1000) });
  const out = buildStatus({ profile: { is_verified: false }, request: r, last: r, history: empty, photoCount: AVEC_PHOTOS }, NOW);
  assert.equal(out.state, 'idle');
  assert.equal(out.canStart, true);
});

test('selfie envoyé → pending, et la revue N\'EXPIRE PAS même des jours après', () => {
  const r = request({ status: 'pending_review', submitted_at: iso(-6 * 24 * 3600 * 1000), capture_expires_at: iso(-6 * 24 * 3600 * 1000) });
  const out = buildStatus({ profile: { is_verified: false }, request: r, last: r, history: empty, photoCount: AVEC_PHOTOS }, NOW);
  assert.equal(out.state, 'pending');
  assert.equal(out.canStart, false);
});

test('profil vérifié → verified, quoi qu\'il y ait en base', () => {
  const out = buildStatus({
    profile: { is_verified: true, verified_at: '2026-07-10T09:00:00Z' },
    request: request({ status: 'pending_review' }), last: null, history: empty,
  }, NOW);
  assert.equal(out.state, 'verified');
  assert.equal(out.verifiedAt, '2026-07-10T09:00:00Z');
  assert.equal(out.canStart, false);
});

test('refus sous le seuil d\'essais libres → rejected avec le motif, peut relancer tout de suite', () => {
  const last = request({ status: 'rejected', rejection_reason: 'Visage non visible' });
  const out = buildStatus({
    profile: { is_verified: false }, request: null, last,
    history: { attempts: 1, lastRejectedAt: iso(-60 * 1000) }, photoCount: AVEC_PHOTOS,
  }, NOW);
  assert.equal(out.state, 'rejected');
  assert.equal(out.rejectionReason, 'Visage non visible');
  assert.equal(out.canStart, true);
});

test('essais libres épuisés → cooldown, avec la date de réouverture', () => {
  const lastRejectedAt = iso(-3600 * 1000); // il y a 1 h
  const out = buildStatus({
    profile: { is_verified: false }, request: null,
    last: request({ status: 'rejected', rejection_reason: 'Pose non respectée' }),
    history: { attempts: FREE_ATTEMPTS, lastRejectedAt }, photoCount: AVEC_PHOTOS,
  }, NOW);
  assert.equal(out.state, 'cooldown');
  assert.equal(out.canStart, false);
  assert.equal(out.retryAt, new Date(new Date(lastRejectedAt).getTime() + COOLDOWN_MS).toISOString());
  // Le motif reste visible pendant l'attente : sinon on attend sans savoir quoi corriger.
  assert.equal(out.rejectionReason, 'Pose non respectée');
});

test('cooldown écoulé → on repasse à rejected (relance possible)', () => {
  const out = buildStatus({
    profile: { is_verified: false }, request: null,
    last: request({ status: 'rejected', rejection_reason: 'Flou' }),
    history: { attempts: FREE_ATTEMPTS + 2, lastRejectedAt: iso(-COOLDOWN_MS - 1000) }, photoCount: AVEC_PHOTOS,
  }, NOW);
  assert.equal(out.state, 'rejected');
  assert.equal(out.canStart, true);
});

test('ligne admin : la consigne exacte imposée accompagne le selfie', () => {
  const r = request({
    status: 'pending_review', submitted_at: iso(-3600 * 1000),
    attempt_no: 2, selfie_path: 'u1/1753000000-abc.jpg',
  });
  const item = buildQueueItem(r, {
    prenom: 'Mariama', avatarUrl: 'https://x/a.jpg',
    photos: ['https://x/1.jpg', 'https://x/2.jpg'], dejaVerifiee: false,
  });

  assert.equal(item.poseInstruction, POSES[0].instruction);
  assert.equal(item.poseCode, POSES[0].code);
  assert.equal(item.photos.length, 2);
  assert.equal(item.tentative, 2);
});

test('ligne admin : AUCUNE URL de selfie ne sort de la file', () => {
  // La photo est biométrique : elle ne circule que dans une réponse
  // authentifiée (GET /admin/verifications/:id/selfie), jamais sous forme
  // d'URL signée déposée dans le DOM, où elle serait copiable et ouvrable
  // sans authentification jusqu'à son expiration.
  const r = request({ status: 'pending_review', submitted_at: iso(0), selfie_path: 'u1/x.jpg' });
  const item = buildQueueItem(r, null);
  assert.equal(item.selfieUrl, undefined);
  assert.equal(item.selfiePath, undefined);
  assert.equal(item.aSelfie, true);
});

test('ligne admin : sans fichier attaché → aSelfie faux, la ligne reste affichable', () => {
  const r = request({ status: 'pending_review', submitted_at: iso(0), selfie_path: null });
  const item = buildQueueItem(r, null);
  assert.equal(item.aSelfie, false);
  assert.equal(item.prenom, null);
  // Sans le repli, un code de pose inconnu laisserait l'admin sans consigne.
  assert.equal(typeof item.poseInstruction, 'string');
});
