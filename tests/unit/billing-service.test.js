'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// billing.service — le webhook RevenueCat reflété chez nous. RC est la SOURCE
// DE VÉRITÉ ; on teste le miroir : mapping entitlements → palier (plus/or/
// prestige, le plus haut gagne), activation/expiration, consommables crédités
// une seule fois (idempotence transaction), événements ignorés sans casse.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBillingService } = require('../../src/services/billing.service');

const CONFIG = { revenuecat: { entitlementId: 'or' } };

function fakeProfiles() {
  return {
    statuses: [],
    async setPremiumStatus(userId, status) {
      this.statuses.push({ userId, ...status });
    },
    get last() { return this.statuses[this.statuses.length - 1]; },
  };
}

function fakeCredits() {
  return {
    granted: [],
    async grant(profileId, amounts) { this.granted.push({ profileId, ...amounts }); },
  };
}

/** Catalogue consommables + registre de transactions, en mémoire. */
function fakePurchases(products = {}) {
  const seen = new Set();
  return {
    recorded: [],
    async findProductByStoreId(storeProductId) { return products[storeProductId] ?? null; },
    async wasProcessed(txId) { return seen.has(txId); },
    async record({ profileId, productId, storeTransactionId, quantity }) {
      if (storeTransactionId) seen.add(storeTransactionId);
      this.recorded.push({ profileId, productId, storeTransactionId, quantity });
    },
  };
}

const PRODUCTS = {
  'com.mbenguiste.superlike.5': { id: 'p-sl5', kind: 'superlike', quantity: 5 },
  'com.mbenguiste.boost.10':    { id: 'p-b10', kind: 'boost', quantity: 10 },
  'com.mbenguiste.joker.3':     { id: 'p-j3', kind: 'joker', quantity: 3 },
};

function makeService() {
  const profiles = fakeProfiles();
  const credits = fakeCredits();
  const purchases = fakePurchases(PRODUCTS);
  const service = createBillingService({ config: CONFIG, profiles, credits, purchases });
  return { service, profiles, credits, purchases };
}

const EXP_MS = new Date('2026-12-31T00:00:00Z').getTime();

// ── Abonnements : mapping entitlements → palier ──────────────────────────────

for (const tier of ['plus', 'or', 'prestige']) {
  test(`INITIAL_PURCHASE entitlement '${tier}' → palier ${tier} + échéance`, async () => {
    const { service, profiles } = makeService();
    await service.handleEvent({
      type: 'INITIAL_PURCHASE', app_user_id: 'u1',
      entitlement_ids: [tier], expiration_at_ms: EXP_MS,
    });
    assert.equal(profiles.last.userId, 'u1');
    assert.equal(profiles.last.tier, tier);
    assert.equal(profiles.last.premiumUntil, new Date(EXP_MS).toISOString());
  });
}

test('plusieurs entitlements simultanés → le plus HAUT gagne (prestige > or > plus)', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({
    type: 'RENEWAL', app_user_id: 'u1',
    entitlement_ids: ['plus', 'prestige', 'or'], expiration_at_ms: EXP_MS,
  });
  assert.equal(profiles.last.tier, 'prestige');
});

test('événement sans entitlement_ids (ancien format, entitlement unique) → or', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'INITIAL_PURCHASE', app_user_id: 'u1', expiration_at_ms: EXP_MS });
  assert.equal(profiles.last.tier, 'or');
});

test('entitlement inconnu uniquement → événement ignoré (aucune écriture)', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({
    type: 'INITIAL_PURCHASE', app_user_id: 'u1',
    entitlement_ids: ['vip_inconnu'], expiration_at_ms: EXP_MS,
  });
  assert.equal(profiles.statuses.length, 0);
});

for (const type of ['RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED']) {
  test(`${type} : active/prolonge comme un achat`, async () => {
    const { service, profiles } = makeService();
    await service.handleEvent({ type, app_user_id: 'u1', entitlement_ids: ['or'], expiration_at_ms: EXP_MS });
    assert.equal(profiles.last.tier, 'or');
  });
}

test('PRODUCT_CHANGE or → prestige : upgrade reflété', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'INITIAL_PURCHASE', app_user_id: 'u1', entitlement_ids: ['or'], expiration_at_ms: EXP_MS });
  await service.handleEvent({ type: 'PRODUCT_CHANGE', app_user_id: 'u1', entitlement_ids: ['prestige'], expiration_at_ms: EXP_MS });
  assert.equal(profiles.last.tier, 'prestige');
});

test('EXPIRATION : coupe l\'accès (tier null, échéance nulle)', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'EXPIRATION', app_user_id: 'u1', entitlement_ids: ['or'] });
  assert.equal(profiles.last.tier, null);
  assert.equal(profiles.last.premiumUntil, null);
});

test('CANCELLATION : rien à faire (l\'accès court jusqu\'à EXPIRATION)', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'CANCELLATION', app_user_id: 'u1', entitlement_ids: ['or'] });
  assert.equal(profiles.statuses.length, 0);
});

test('sans expiration_at_ms : activation avec échéance nulle (le garde-fou lit premium_until)', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'INITIAL_PURCHASE', app_user_id: 'u1', entitlement_ids: ['plus'] });
  assert.equal(profiles.last.tier, 'plus');
  assert.equal(profiles.last.premiumUntil, null);
});

// ── Consommables ─────────────────────────────────────────────────────────────

test('NON_RENEWING_PURCHASE superlike : crédite la bonne quantité et enregistre la transaction', async () => {
  const { service, credits, purchases } = makeService();
  await service.handleEvent({
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1',
    product_id: 'com.mbenguiste.superlike.5', transaction_id: 'tx1',
  });
  assert.deepEqual(credits.granted, [{ profileId: 'u1', superLikes: 5, boosts: 0, jokers: 0 }]);
  assert.equal(purchases.recorded.length, 1);
  assert.equal(purchases.recorded[0].storeTransactionId, 'tx1');
});

test('NON_RENEWING_PURCHASE boost : crédite le solde boost', async () => {
  const { service, credits } = makeService();
  await service.handleEvent({
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1',
    product_id: 'com.mbenguiste.boost.10', transaction_id: 'tx2',
  });
  assert.deepEqual(credits.granted, [{ profileId: 'u1', superLikes: 0, boosts: 10, jokers: 0 }]);
});

test('NON_RENEWING_PURCHASE joker : crédite le solde joker (Lot B, catalogue à venir)', async () => {
  const { service, credits } = makeService();
  await service.handleEvent({
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1',
    product_id: 'com.mbenguiste.joker.3', transaction_id: 'tx3',
  });
  assert.deepEqual(credits.granted, [{ profileId: 'u1', superLikes: 0, boosts: 0, jokers: 3 }]);
});

test('idempotence : la même transaction rejouée ne crédite qu\'UNE fois', async () => {
  const { service, credits } = makeService();
  const event = {
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1',
    product_id: 'com.mbenguiste.superlike.5', transaction_id: 'txDUP',
  };
  await service.handleEvent(event);
  await service.handleEvent(event); // RC réessaie → sans effet
  assert.equal(credits.granted.length, 1);
});

test('produit inconnu au catalogue : ignoré sans erreur', async () => {
  const { service, credits } = makeService();
  await service.handleEvent({
    type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1',
    product_id: 'com.autre.app.truc', transaction_id: 'tx9',
  });
  assert.equal(credits.granted.length, 0);
});

// ── Robustesse ───────────────────────────────────────────────────────────────

test('événement nul ou sans app_user_id : no-op silencieux', async () => {
  const { service, profiles, credits } = makeService();
  await service.handleEvent(null);
  await service.handleEvent({ type: 'INITIAL_PURCHASE' });
  assert.equal(profiles.statuses.length, 0);
  assert.equal(credits.granted.length, 0);
});

test('type inconnu (TEST, TRANSFER…) : no-op silencieux', async () => {
  const { service, profiles } = makeService();
  await service.handleEvent({ type: 'TEST', app_user_id: 'u1' });
  assert.equal(profiles.statuses.length, 0);
});
