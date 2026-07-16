'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// picks.service — les Coups de cœur du jour. Doctrine (15/07) : le paywall est
// sur l'ACTION, pas la vue. Tout le monde VOIT la sélection ; liker est gratuit
// 1×/jour, au-delà = Or (402 picks_like, la source la plus chaude). Un membre
// avec la capacité `picksIllimites` (Or payé, jamais l'offert) like sans compter.
// Service testé via sa factory (fakes en mémoire).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPicksService } = require('../../src/services/picks.service');

const CONFIG = { limits: { freePicksLikesPerDay: 1 } };

function fakeUsage() {
  const counters = new Map();
  return {
    calls: [],
    async consume(id, kind, limit) {
      this.calls.push({ id, kind, limit });
      const key = `${id}:${kind}`;
      const used = counters.get(key) ?? 0;
      if (used >= limit) return { allowed: false, remaining: 0, resetAt: '2026-07-16T00:00:00.000Z' };
      counters.set(key, used + 1);
      return { allowed: true, remaining: limit - used - 1, resetAt: '2026-07-16T00:00:00.000Z' };
    },
  };
}

function fakeSwipes() {
  return {
    recorded: [],
    async record(swiperId, targetId, action, cible = null) {
      this.recorded.push({ swiperId, targetId, action, cible });
      return { match: null };
    },
  };
}

function fakeAccess(caps = {}) {
  return { async forUser() { return { tier: 'free', offert: false, caps: { picksIllimites: false, ...caps } }; } };
}

function makeService({ caps = {} } = {}) {
  const usage = fakeUsage();
  const swipes = fakeSwipes();
  const service = createPicksService({
    config: CONFIG, access: fakeAccess(caps), usage, swipes,
    // dailySelection non testée ici (déléguée au domaine) → stubs neutres.
    discovery: { async candidates() { return []; } },
    profiles: { async findById() { return { id: 'me', interets: [], langues: [] }; } },
  });
  return { service, usage, swipes };
}

// ── Like depuis la sélection : le quota 1/jour ────────────────────────────────

test('gratuit : 1re interaction du jour passe, la 2e → 402 picks_like', async () => {
  const { service, swipes } = makeService();
  await service.likeFromPicks('u1', 't1'); // 1re du jour : offerte
  await assert.rejects(
    () => service.likeFromPicks('u1', 't2'),
    (err) => {
      assert.equal(err.statusCode, 402);
      assert.equal(err.details.code, 'PICKS_LIMIT');
      assert.equal(err.details.source, 'picks_like');
      assert.ok(err.details.resetAt);
      return true;
    },
  );
  assert.equal(swipes.recorded.length, 1, 'seul le 1er like a été enregistré');
});

test('le 402 n\'enregistre PAS le like', async () => {
  const { service, swipes, usage } = makeService();
  // épuise le quota du jour
  await service.likeFromPicks('u1', 't1');
  await assert.rejects(() => service.likeFromPicks('u1', 't2'));
  assert.equal(swipes.recorded.length, 1);
  assert.ok(usage.calls.every((c) => c.kind === 'picks_like'), 'compté sur le quota picks_like dédié');
});

test('capacité picksIllimites (Or payé) : like sans compter, aucun quota consommé', async () => {
  const { service, usage, swipes } = makeService({ caps: { picksIllimites: true } });
  await service.likeFromPicks('u1', 't1');
  await service.likeFromPicks('u1', 't2');
  await service.likeFromPicks('u1', 't3');
  assert.equal(swipes.recorded.length, 3);
  assert.equal(usage.calls.length, 0, 'illimité = on ne compte même pas');
});

test('like ciblé (photo/prompt + mot) : la cible est transmise au modèle', async () => {
  const { service, swipes } = makeService({ caps: { picksIllimites: true } });
  const cible = { type: 'prompt', ref: 'weekend', comment: 'Cette réponse m\'a fait sourire' };
  await service.likeFromPicks('u1', 't1', cible);
  assert.equal(swipes.recorded[0].action, 'like');
  assert.deepEqual(swipes.recorded[0].cible, cible);
});

// ── Sélection du jour (délégation domaine) ────────────────────────────────────

test('dailySelection : score le pool et rend les plus compatibles', async () => {
  const usage = fakeUsage();
  const pool = [
    { id: 'faible', interets: [], langues: [] },
    { id: 'fort', interets: [{ code: 'rando' }], langues: ['fr'], bio: 'x', estVerifie: true },
  ];
  const service = createPicksService({
    config: CONFIG, access: fakeAccess(), usage, swipes: fakeSwipes(),
    discovery: { async candidates() { return pool; } },
    profiles: { async findById() { return { interets: [{ code: 'rando' }], langues: ['fr'] }; } },
  });
  const out = await service.dailySelection('u1', { count: 1, now: Date.parse('2026-07-15T10:00:00Z') });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'fort');
});
