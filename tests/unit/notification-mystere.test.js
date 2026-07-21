'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// NOTIF — « ton mystère a pris fin ». Quand un membre TERMINE le mystère (sortie
// propre unilatérale), l'autre doit être prévenu, sinon il attend une réponse qui
// ne viendra jamais. Le push est ANONYME (doctrine) : on ne dit jamais QUI a mis
// fin, ni son prénom — juste que le mystère est terminé.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationService } = require('../../src/services/notification.service');

/** Faux Supabase : `profiles.select('notif_push').eq('id',…).maybeSingle()`. */
function fakeSupabase(profile) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) };
}

test('onMystereEnded : envoie un push au partenaire, marqué type mystere_ended', async () => {
  const sent = [];
  const svc = createNotificationService({
    sendPush: async (uid, payload) => sent.push({ uid, payload }),
    supabase: fakeSupabase({ notif_push: true }),
  });
  await svc.onMystereEnded('U');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].uid, 'U');
  assert.equal(sent[0].payload.data.type, 'mystere_ended');
  assert.ok(sent[0].payload.body && sent[0].payload.body.length > 0);
});

test('onMystereEnded : respecte la coupure des push (notif_push=false)', async () => {
  const sent = [];
  const svc = createNotificationService({
    sendPush: async (...a) => sent.push(a),
    supabase: fakeSupabase({ notif_push: false }),
  });
  await svc.onMystereEnded('U');
  assert.equal(sent.length, 0);
});

test('onMystereEnded : best-effort — un échec de push ne lève jamais', async () => {
  const svc = createNotificationService({
    sendPush: async () => { throw new Error('push down'); },
    supabase: fakeSupabase({ notif_push: true }),
  });
  await assert.doesNotReject(svc.onMystereEnded('U'));
});

// ── « Un mystère t'attend » — à la création d'une paire ──────────────────────
test('onMystereProposed : push ANONYME (type mystere_proposed, aucun prénom/avatar)', async () => {
  const sent = [];
  const svc = createNotificationService({
    sendPush: async (uid, payload) => sent.push({ uid, payload }),
    supabase: fakeSupabase({ notif_push: true }),
  });
  await svc.onMystereProposed('U');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].uid, 'U');
  assert.equal(sent[0].payload.data.type, 'mystere_proposed');
  assert.ok(sent[0].payload.body?.length > 0);
  // Anonymat : ni id, ni clés qui trahiraient l'identité du partenaire.
  const s = JSON.stringify(sent[0].payload);
  assert.equal(/prenom|first_name|avatar|photo|name/i.test(s), false);
});

test('onMystereProposed : respecte la coupure des push', async () => {
  const sent = [];
  const svc = createNotificationService({
    sendPush: async (...a) => sent.push(a),
    supabase: fakeSupabase({ notif_push: false }),
  });
  await svc.onMystereProposed('U');
  assert.equal(sent.length, 0);
});

test('onMystereProposed : best-effort — un échec de push ne lève jamais', async () => {
  const svc = createNotificationService({
    sendPush: async () => { throw new Error('push down'); },
    supabase: fakeSupabase({ notif_push: true }),
  });
  await assert.doesNotReject(svc.onMystereProposed('U'));
});
