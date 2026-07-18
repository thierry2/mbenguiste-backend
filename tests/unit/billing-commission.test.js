'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// billing.service × commissions : quand un abonné RÉFÉRÉ paie, une commission
// est inscrite (net × taux du partenaire) ; sinon rien. Idempotence par event_id,
// gel du partenaire, remboursement (réversion). Tout à sec (fakes injectés).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBillingService } = require('../../src/services/billing.service');

const CONFIG = { revenuecat: { entitlementId: 'or' } };
const NOW = new Date('2026-07-18T12:00:00Z');

const fakeProfiles = () => ({ async setPremiumStatus() {} });
const fakeCredits = () => ({ async grant() {} });
const fakePurchases = () => ({
  async findProductByStoreId() { return null; },
  async wasProcessed() { return false; },
  async record() {},
});

function fakeReferrals(map = {}) {
  return { async findByProfile(id) { return map[id] || null; } };
}
function fakePartners(map = {}) {
  return { async findById(id) { return map[id] || null; } };
}
function fakeCommissions(firstAt = null) {
  return {
    recorded: [], reversed: [], _first: firstAt,
    async firstOccurredAt() { return this._first; },
    async record(spec) {
      if (this.recorded.some((r) => r.eventId === spec.eventId)) return; // event_id unique
      this.recorded.push(spec);
    },
    async reverseByEventId(eventId) { this.reversed.push(eventId); },
  };
}

function makeService({ referrals, partners, commissions } = {}) {
  return createBillingService({
    config: CONFIG,
    profiles: fakeProfiles(),
    credits: fakeCredits(),
    purchases: fakePurchases(),
    referrals, partners, commissions,
    now: () => NOW,
  });
}

const PURCHASE = (over = {}) => ({
  type: 'INITIAL_PURCHASE', app_user_id: 'member1',
  entitlement_ids: ['or'], expiration_at_ms: new Date('2026-08-18').getTime(),
  price: 11.99, currency: 'EUR', takehome_percentage: 0.7,
  purchased_at_ms: new Date('2026-07-18T00:00:00Z').getTime(),
  transaction_id: 'tx_1', ...over,
});

test('abonné référé qui paie → commission inscrite (net × taux)', async () => {
  const commissions = fakeCommissions();
  const service = makeService({
    referrals: fakeReferrals({ member1: { partnerId: 'partnerA' } }),
    partners: fakePartners({ partnerA: { id: 'partnerA', rateBps: 4000, status: 'active' } }),
    commissions,
  });
  await service.handleEvent(PURCHASE());
  assert.equal(commissions.recorded.length, 1);
  const c = commissions.recorded[0];
  assert.equal(c.partnerId, 'partnerA');
  assert.equal(c.profileId, 'member1');
  assert.equal(c.eventId, 'tx_1');
  assert.equal(c.commissionCents, 336); // 839 × 0,40
});

test('abonné NON référé → aucune commission', async () => {
  const commissions = fakeCommissions();
  const service = makeService({
    referrals: fakeReferrals({}),
    partners: fakePartners({}),
    commissions,
  });
  await service.handleEvent(PURCHASE());
  assert.equal(commissions.recorded.length, 0);
});

test('partenaire gelé (frozen) → aucune commission', async () => {
  const commissions = fakeCommissions();
  const service = makeService({
    referrals: fakeReferrals({ member1: { partnerId: 'partnerA' } }),
    partners: fakePartners({ partnerA: { id: 'partnerA', rateBps: 3000, status: 'frozen' } }),
    commissions,
  });
  await service.handleEvent(PURCHASE());
  assert.equal(commissions.recorded.length, 0);
});

test('rejeu du même événement (même transaction_id) → une seule commission', async () => {
  const commissions = fakeCommissions();
  const service = makeService({
    referrals: fakeReferrals({ member1: { partnerId: 'partnerA' } }),
    partners: fakePartners({ partnerA: { id: 'partnerA', rateBps: 3000, status: 'active' } }),
    commissions,
  });
  await service.handleEvent(PURCHASE());
  await service.handleEvent(PURCHASE()); // RC réessaie
  assert.equal(commissions.recorded.length, 1);
});

test('remboursement (CANCELLATION/CUSTOMER_SUPPORT) → réversion par transaction', async () => {
  const commissions = fakeCommissions();
  const service = makeService({
    referrals: fakeReferrals({ member1: { partnerId: 'partnerA' } }),
    partners: fakePartners({ partnerA: { id: 'partnerA', rateBps: 3000, status: 'active' } }),
    commissions,
  });
  await service.handleEvent({
    type: 'CANCELLATION', app_user_id: 'member1',
    cancel_reason: 'CUSTOMER_SUPPORT', transaction_id: 'tx_1',
  });
  assert.deepEqual(commissions.reversed, ['tx_1']);
});

test('sans modules partenaires câblés (tests legacy) → pas de crash, no-op', async () => {
  const service = createBillingService({
    config: CONFIG, profiles: fakeProfiles(), credits: fakeCredits(), purchases: fakePurchases(),
  });
  await service.handleEvent(PURCHASE()); // ne doit rien lever
  assert.ok(true);
});
