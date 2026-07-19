'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// partnerStats (pur) : solde dérivé (validé = hold J+30 écoulé), somme du mois,
// lignes payables. Aucun cron.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBalance, sumSince, payableRows, dailySeries } = require('../../src/domain/partnerStats');

const NOW = new Date('2026-07-18T12:00:00Z');
const past = new Date('2026-07-01T00:00:00Z').toISOString();   // hold écoulé
const future = new Date('2026-08-10T00:00:00Z').toISOString(); // hold à venir

const ROWS = [
  { commissionCents: 252, status: 'pending', holdUntil: future, occurredAt: '2026-07-15T00:00:00Z' }, // en attente
  { commissionCents: 300, status: 'pending', holdUntil: past,   occurredAt: '2026-06-20T00:00:00Z' }, // validé (hold écoulé)
  { commissionCents: 407, status: 'paid',    holdUntil: past,   occurredAt: '2026-05-10T00:00:00Z' }, // versé
  { commissionCents: 999, status: 'reversed',holdUntil: past,   occurredAt: '2026-07-02T00:00:00Z' }, // remboursé → ignoré
];

test('summarizeBalance : hold écoulé → validé, hold à venir → en attente', () => {
  const b = summarizeBalance(ROWS, NOW);
  assert.equal(b.pendingCents, 252);
  assert.equal(b.validatedCents, 300);
  assert.equal(b.paidCents, 407);
});

test('summarizeBalance : statut validated explicite compte comme validé', () => {
  const b = summarizeBalance([{ commissionCents: 100, status: 'validated', holdUntil: future }], NOW);
  assert.equal(b.validatedCents, 100);
});

test('sumSince : additionne le mois en cours, ignore les remboursées', () => {
  const monthStart = new Date('2026-07-01T00:00:00Z');
  // 252 (15/07) + 999 remboursé ignoré = 252 ; le 20/06 et 10/05 hors mois.
  assert.equal(sumSince(ROWS, monthStart), 252);
});

test('payableRows : validées explicites + pending au hold écoulé', () => {
  const payable = payableRows(ROWS, NOW);
  assert.equal(payable.length, 1);
  assert.equal(payable[0].commissionCents, 300);
});

test('dailySeries : un point par jour, zéros compris, du plus ancien au plus récent', () => {
  const serie = dailySeries(ROWS, { days: 7, now: NOW });
  assert.equal(serie.length, 7);
  assert.equal(serie[0].date, '2026-07-12');
  assert.equal(serie[6].date, '2026-07-18');
  // Le 15/07 porte la commission de 252 ; les autres jours de la fenêtre sont à 0.
  assert.equal(serie.find((p) => p.date === '2026-07-15').cents, 252);
  assert.equal(serie.find((p) => p.date === '2026-07-14').cents, 0);
});

test('dailySeries : ignore les remboursées et ce qui sort de la fenêtre', () => {
  const serie = dailySeries(ROWS, { days: 7, now: NOW });
  // 999 (remboursée, le 02/07) et 300/407 (hors fenêtre) ne comptent pas.
  assert.equal(serie.reduce((s, p) => s + p.cents, 0), 252);
});
