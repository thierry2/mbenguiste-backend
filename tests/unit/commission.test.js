'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// commission (domaine pur) : net après part store × taux, en centimes ; fenêtre
// 12 mois ; hold J+30 ; essais gratuits et types non payants ignorés.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCommission, HOLD_DAYS } = require('../../src/domain/commission');

const NOW = new Date('2026-07-18T12:00:00Z');
const AT = (iso) => new Date(iso).getTime();

// Or à 11,99 € : net = 11,99 × 0,70 = 8,393 € → 839 c ; 30 % → 252 c.
const OR_PURCHASE = {
  type: 'INITIAL_PURCHASE', price: 11.99, currency: 'EUR',
  takehome_percentage: 0.7, purchased_at_ms: AT('2026-07-18T00:00:00Z'),
};

test('INITIAL_PURCHASE : net après part store × 30 %, en centimes', () => {
  const c = computeCommission({ event: OR_PURCHASE, rateBps: 3000, now: NOW });
  assert.equal(c.grossCents, 1199);
  assert.equal(c.netCents, 839);
  assert.equal(c.commissionCents, 252);       // round(839 × 0,30)
  assert.equal(c.currency, 'EUR');
  assert.equal(c.eventType, 'INITIAL_PURCHASE');
});

test('taux Fondateur (40 %) commissionne plus', () => {
  const c = computeCommission({ event: OR_PURCHASE, rateBps: 4000, now: NOW });
  assert.equal(c.commissionCents, 336);       // round(839 × 0,40)
});

test('hold = occurrence + 30 jours', () => {
  const c = computeCommission({ event: OR_PURCHASE, rateBps: 3000, now: NOW });
  const expected = AT('2026-07-18T00:00:00Z') + HOLD_DAYS * 86400000;
  assert.equal(c.holdUntil.getTime(), expected);
  assert.equal(c.occurredAt.getTime(), AT('2026-07-18T00:00:00Z'));
});

test('RENEWAL dans la fenêtre 12 mois → commissionne', () => {
  const first = new Date('2026-01-10T00:00:00Z');
  const renewal = { ...OR_PURCHASE, type: 'RENEWAL', purchased_at_ms: AT('2026-11-10T00:00:00Z') };
  const c = computeCommission({ event: renewal, rateBps: 3000, firstPaymentAt: first, now: NOW });
  assert.ok(c && c.commissionCents === 252);
});

test('RENEWAL au-delà de 12 mois → null (fenêtre fermée)', () => {
  const first = new Date('2026-01-10T00:00:00Z');
  const renewal = { ...OR_PURCHASE, type: 'RENEWAL', purchased_at_ms: AT('2027-02-10T00:00:00Z') };
  const c = computeCommission({ event: renewal, rateBps: 3000, firstPaymentAt: first, now: NOW });
  assert.equal(c, null);
});

test('essai gratuit (prix 0) → null', () => {
  const c = computeCommission({ event: { ...OR_PURCHASE, price: 0 }, rateBps: 3000, now: NOW });
  assert.equal(c, null);
});

test('type non payant (CANCELLATION) → null', () => {
  const c = computeCommission({ event: { ...OR_PURCHASE, type: 'CANCELLATION' }, rateBps: 3000, now: NOW });
  assert.equal(c, null);
});

test('takehome_percentage absent → repli 0,70 conservateur', () => {
  const noTakehome = { type: 'INITIAL_PURCHASE', price: 11.99, currency: 'EUR', purchased_at_ms: AT('2026-07-18T00:00:00Z') };
  const c = computeCommission({ event: noTakehome, rateBps: 3000, now: NOW });
  assert.equal(c.netCents, 839);              // 11,99 × 0,70
});

test('Plus hebdo à 3,99 € (part store 15 %) → net et commission cohérents', () => {
  const plusWeek = { type: 'INITIAL_PURCHASE', price: 3.99, currency: 'EUR', takehome_percentage: 0.85, purchased_at_ms: AT('2026-07-18T00:00:00Z') };
  const c = computeCommission({ event: plusWeek, rateBps: 3000, now: NOW });
  assert.equal(c.grossCents, 399);
  assert.equal(c.netCents, 339);              // round(3,99 × 0,85 × 100) = round(339,15)
  assert.equal(c.commissionCents, 102);       // round(339 × 0,30) = round(101,7)
});
