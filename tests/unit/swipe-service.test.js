'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// swipe.service — c'est ICI que la conversion se joue. Tous les chemins :
//  - pass : toujours autorisé, ne touche ni quota ni crédit ;
//  - like : illimité si la capacité le donne (Plus+, femme offerte), sinon
//    quota gratuit 20/12 h puis 402 LIKE_LIMIT ;
//  - super_like : quota 1/24 h POUR TOUT LE MONDE (l'Or n'est PLUS illimité —
//    doctrine 15/07), puis crédit acheté/granté, puis 402 SUPERLIKE_EMPTY.
// Service testé en isolation via sa factory (fakes en mémoire).
// ─────────────────────────────────────────────────────────────────────────────
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createSwipeService } = require('../../src/services/swipe.service');

// ── Fakes minimaux, comportement observable ──────────────────────────────────

function fakeUsage() {
  const counters = new Map(); // `${id}:${kind}` → used
  return {
    calls: [],
    async consume(profileId, kind, limit) {
      this.calls.push({ profileId, kind, limit });
      const key = `${profileId}:${kind}`;
      const used = counters.get(key) ?? 0;
      if (used >= limit) return { allowed: false, remaining: 0, resetAt: '2026-07-16T00:00:00.000Z' };
      counters.set(key, used + 1);
      return { allowed: true, remaining: limit - used - 1, resetAt: '2026-07-16T00:00:00.000Z' };
    },
    _set(profileId, kind, used) { counters.set(`${profileId}:${kind}`, used); },
  };
}

function fakeCredits(superLikes = 0) {
  let balance = superLikes;
  return {
    get balance() { return balance; },
    async spendSuperLike() {
      if (balance <= 0) return false;
      balance -= 1;
      return true;
    },
  };
}

function fakeSwipes({ last = null } = {}) {
  return {
    recorded: [],
    deleteCalls: [],
    _last: last, // { targetId, action } | null
    async record(swiperId, targetId, action, cible = null) {
      this.recorded.push({ swiperId, targetId, action, cible });
      return { match: null };
    },
    async deleteLast(swiperId) {
      this.deleteCalls.push(swiperId);
      const l = this._last;
      this._last = null; // consommé
      return l;
    },
  };
}

function fakeAccess(caps) {
  return {
    async forUser() {
      return {
        tier: 'free',
        offert: false,
        caps: {
          likesIllimites: false, peutRewind: false, peutIncognito: false,
          filtresAvances: false, traductionIllimitee: false, grilleDefloutee: false,
          picksIllimites: false, priorityLikes: false, motAvantMatch: false,
          ...caps,
        },
      };
    },
  };
}

const CONFIG = { limits: { freeLikesPer12h: 20, freeSuperLikesPerDay: 1 } };

function makeService({ caps = {}, superLikeCredits = 0, last = null } = {}) {
  const usage = fakeUsage();
  const credits = fakeCredits(superLikeCredits);
  const swipes = fakeSwipes({ last });
  const service = createSwipeService({
    config: CONFIG, access: fakeAccess(caps), usage, credits, swipes,
  });
  return { service, usage, credits, swipes };
}

// ── PASS ─────────────────────────────────────────────────────────────────────

test('pass : toujours autorisé, aucun quota ni crédit consommé', async () => {
  const { service, usage, swipes } = makeService();
  usage._set('u1', 'like', 999); // quotas épuisés partout : sans effet sur pass
  await service.applySwipe('u1', 't1', 'pass');
  assert.equal(swipes.recorded.length, 1);
  assert.equal(swipes.recorded[0].action, 'pass');
  assert.equal(usage.calls.length, 0, 'pass ne touche jamais un compteur');
});

// ── LIKE ─────────────────────────────────────────────────────────────────────

test('like gratuit : consomme le quota 20/12 h puis 402 LIKE_LIMIT', async () => {
  const { service, usage } = makeService();
  usage._set('u1', 'like', 19);
  await service.applySwipe('u1', 't1', 'like'); // 20e : passe

  await assert.rejects(
    () => service.applySwipe('u1', 't2', 'like'),
    (err) => {
      assert.equal(err.statusCode, 402);
      assert.equal(err.details.code, 'LIKE_LIMIT');
      assert.equal(err.details.source, 'discover_likes');
      assert.ok(err.details.resetAt, 'resetAt exposé pour afficher le compte à rebours');
      return true;
    },
  );
});

test('like : le 402 n\'enregistre PAS le swipe', async () => {
  const { service, usage, swipes } = makeService();
  usage._set('u1', 'like', 20);
  await assert.rejects(() => service.applySwipe('u1', 't1', 'like'));
  assert.equal(swipes.recorded.length, 0);
});

test('like avec capacité likesIllimites (Plus, Or, femme offerte) : aucun quota consommé', async () => {
  const { service, usage, swipes } = makeService({ caps: { likesIllimites: true } });
  usage._set('u1', 'like', 999);
  await service.applySwipe('u1', 't1', 'like');
  assert.equal(swipes.recorded.length, 1);
  assert.equal(usage.calls.length, 0, 'illimité = on ne compte même pas');
});

test('like ciblé : la cible (photo/prompt + mot) est transmise au modèle', async () => {
  const { service, swipes } = makeService({ caps: { likesIllimites: true } });
  const cible = { type: 'photo', ref: 'p1', comment: 'Superbe sourire' };
  await service.applySwipe('u1', 't1', 'like', cible);
  assert.deepEqual(swipes.recorded[0].cible, cible);
});

// ── SUPER LIKE ───────────────────────────────────────────────────────────────

test('super_like gratuit : 1/24 h passe, le 2e sans crédit → 402 SUPERLIKE_EMPTY', async () => {
  const { service, swipes } = makeService();
  await service.applySwipe('u1', 't1', 'super_like'); // le gratuit du jour
  await assert.rejects(
    () => service.applySwipe('u1', 't2', 'super_like'),
    (err) => {
      assert.equal(err.statusCode, 402);
      assert.equal(err.details.code, 'SUPERLIKE_EMPTY');
      assert.equal(err.details.source, 'discover_superlike');
      return true;
    },
  );
  assert.equal(swipes.recorded.length, 1);
});

test('super_like : quota épuisé → bascule sur les crédits (achetés ou grantés)', async () => {
  const { service, credits, swipes } = makeService({ superLikeCredits: 2 });
  await service.applySwipe('u1', 't1', 'super_like'); // quota gratuit
  await service.applySwipe('u1', 't2', 'super_like'); // crédit 1
  await service.applySwipe('u1', 't3', 'super_like'); // crédit 2
  assert.equal(credits.balance, 0);
  assert.equal(swipes.recorded.length, 3);
  await assert.rejects(() => service.applySwipe('u1', 't4', 'super_like'), /Coups de cœur|Super Like/i);
});

test('super_like membre OR : PAS illimité — même quota 1/24 h + crédits (doctrine 15/07)', async () => {
  // L'Or reçoit ses munitions par le grant hebdo (5 crédits/sem), jamais par un passe-droit.
  const { service, usage, swipes } = makeService({
    caps: { likesIllimites: true, grilleDefloutee: true, traductionIllimitee: true },
    superLikeCredits: 0,
  });
  await service.applySwipe('u1', 't1', 'super_like'); // quota gratuit du jour
  await assert.rejects(
    () => service.applySwipe('u1', 't2', 'super_like'),
    (err) => err.statusCode === 402 && err.details.code === 'SUPERLIKE_EMPTY',
  );
  assert.equal(swipes.recorded.length, 1);
  assert.ok(usage.calls.some((c) => c.kind === 'superlike'), 'le quota est bien compté, même pour l\'Or');
});

test('super_like : le quota gratuit est consommé AVANT les crédits (on ne brûle pas un crédit payé pour rien)', async () => {
  const { service, credits } = makeService({ superLikeCredits: 5 });
  await service.applySwipe('u1', 't1', 'super_like');
  assert.equal(credits.balance, 5, 'le gratuit du jour d\'abord, les crédits intacts');
});

// ── REWIND (Lot C) ───────────────────────────────────────────────────────────

test('rewind sans la capacité (gratuit) : 402 REWIND_LOCKED → paywall discover_rewind', async () => {
  const { service, swipes } = makeService({ last: { targetId: 't1', action: 'like' } });
  await assert.rejects(
    () => service.rewindLast('u1'),
    (err) => {
      assert.equal(err.statusCode, 402);
      assert.equal(err.details.code, 'REWIND_LOCKED');
      assert.equal(err.details.source, 'discover_rewind');
      return true;
    },
  );
  assert.equal(swipes.deleteCalls.length, 0, 'sans la capacité, on ne touche même pas la base');
});

test('rewind avec peutRewind (Plus+) : efface le dernier swipe et rend la carte à restaurer', async () => {
  const { service, swipes } = makeService({
    caps: { peutRewind: true }, last: { targetId: 't9', action: 'pass' },
  });
  const res = await service.rewindLast('u1');
  assert.equal(swipes.deleteCalls.length, 1);
  assert.equal(swipes.deleteCalls[0], 'u1');
  assert.deepEqual(res, { targetId: 't9', action: 'pass' });
});

test('rewind alors qu\'il n\'y a rien à annuler : 400, pas de crash', async () => {
  const { service } = makeService({ caps: { peutRewind: true }, last: null });
  await assert.rejects(
    () => service.rewindLast('u1'),
    (err) => err.statusCode === 400,
  );
});

// ── Action inconnue ──────────────────────────────────────────────────────────

test('action inconnue : rejetée sans rien consommer', async () => {
  const { service, usage, swipes } = makeService();
  await assert.rejects(() => service.applySwipe('u1', 't1', 'mega_like'));
  assert.equal(usage.calls.length, 0);
  assert.equal(swipes.recorded.length, 0);
});
