'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB du catalogue d'abonnements 3 paliers (migration 017, reflétée dans
// schema.sql). La doctrine des offres (docs/doctrine-offres.md §2) fixe :
//  - 3 paliers Plus / Or / Prestige (colonne tier, contrainte de valeurs) ;
//  - des durées hebdo ET mensuelles (colonne period : 'week' | 'month') ;
//  - 10 formules, prix en .99, identifiants store IMMUABLES (invariant n°3) ;
//  - les anciens plans 'gold_*' deviennent le palier 'or' (backfill).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

test('subscription_plans.tier : accepte les 3 paliers, rejette le reste', async () => {
  for (const tier of ['plus', 'or', 'prestige']) {
    await db.query("update subscription_plans set tier = $1 where code = 'gold_1m'", [tier]);
  }
  await assert.rejects(
    () => db.query("update subscription_plans set tier = 'diamant' where code = 'gold_1m'"),
    'la contrainte check doit rejeter un palier inconnu',
  );
  // On remet la valeur juste pour ne pas polluer les tests suivants.
  await db.query("update subscription_plans set tier = 'or' where code = 'gold_1m'");
});

test('subscription_plans.period : accepte week/month, rejette le reste', async () => {
  await db.query("update subscription_plans set period = 'week' where code = 'gold_1m'");
  await db.query("update subscription_plans set period = 'month' where code = 'gold_1m'");
  await assert.rejects(
    () => db.query("update subscription_plans set period = 'year' where code = 'gold_1m'"),
  );
});

test('catalogue : 10 formules seedées, réparties 3 Plus / 4 Or / 3 Prestige', async () => {
  const { rows } = await db.query('select count(*)::int as n from subscription_plans');
  assert.equal(rows[0].n, 10);

  const { rows: byTier } = await db.query(
    'select tier, count(*)::int as n from subscription_plans group by tier order by tier',
  );
  const counts = Object.fromEntries(byTier.map((r) => [r.tier, r.n]));
  assert.deepEqual(counts, { or: 4, plus: 3, prestige: 3 });
});

test('catalogue : prix doctrine + identifiants store immuables', async () => {
  const cases = [
    ['plus_1w',      'plus',     'week',   3.99,  'com.mbenguiste.plus.1w'],
    ['plus_1m',      'plus',     'month',  8.99,  'com.mbenguiste.plus.1m'],
    ['plus_3m',      'plus',     'month', 17.99,  'com.mbenguiste.plus.3m'],
    ['or_1w',        'or',       'week',   5.99,  'com.mbenguiste.or.1w'],
    ['gold_1m',      'or',       'month', 11.99,  'com.mbenguiste.or.1m'],
    ['gold_6m',      'or',       'month', 41.99,  'com.mbenguiste.or.6m'],
    ['gold_12m',     'or',       'month', 59.99,  'com.mbenguiste.or.12m'],
    ['prestige_1m',  'prestige', 'month', 19.99,  'com.mbenguiste.prestige.1m'],
    ['prestige_3m',  'prestige', 'month', 44.99,  'com.mbenguiste.prestige.3m'],
    ['prestige_6m',  'prestige', 'month', 74.99,  'com.mbenguiste.prestige.6m'],
  ];
  for (const [code, tier, period, price, storeId] of cases) {
    const { rows } = await db.query(
      'select tier, period, price_eur, store_product_id from subscription_plans where code = $1', [code],
    );
    assert.equal(rows.length, 1, `plan ${code} présent`);
    assert.equal(rows[0].tier, tier, `${code} tier`);
    assert.equal(rows[0].period, period, `${code} period`);
    assert.equal(Number(rows[0].price_eur), price, `${code} prix`);
    assert.equal(rows[0].store_product_id, storeId, `${code} store id immuable`);
  }
});

test('tous les prix finissent en .99 (règle d\'or n°3)', async () => {
  const { rows } = await db.query('select code, price_eur from subscription_plans');
  for (const r of rows) {
    const cents = Math.round(Number(r.price_eur) * 100) % 100;
    assert.equal(cents, 99, `${r.code} doit finir en .99`);
  }
});
