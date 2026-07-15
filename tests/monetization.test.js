'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB de la monétisation (migration 009, reflétée dans schema.sql) :
//  - le catalogue est bien seedé aux bons prix (.99) et identifiants store ;
//  - RLS : un utilisateur LIT ses propres crédits, jamais ceux d'un autre, et ne
//    peut PAS s'auto-créditer (aucune policy d'écriture → backend service_role only) ;
//  - idempotence : une transaction store ne peut créditer qu'une fois (unique).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

test('catalogue : abonnements en .99 avec identifiant store', async () => {
  const { rows } = await db.query(
    "select price_eur, store_product_id from subscription_plans where code = 'gold_1m'",
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].price_eur), 11.99);
  assert.equal(rows[0].store_product_id, 'com.mbenguiste.or.1m');
});

test('catalogue : 8 consommables seedés (3 Super Likes, 3 Boosts, 2 Jokers), quantités et prix corrects', async () => {
  const { rows } = await db.query('select count(*)::int as n from consumable_products');
  assert.equal(rows[0].n, 8);

  // Jokers (migration 016) : rejeu d'aventure, prix .99.
  const { rows: jk } = await db.query(
    "select kind, quantity, price_eur, store_product_id from consumable_products where code = 'joker_1'",
  );
  assert.equal(jk[0].kind, 'joker');
  assert.equal(jk[0].quantity, 1);
  assert.equal(Number(jk[0].price_eur), 2.99);
  assert.equal(jk[0].store_product_id, 'com.mbenguiste.joker.1');

  const { rows: sl } = await db.query(
    "select kind, quantity, price_eur, store_product_id from consumable_products where code = 'superlike_5'",
  );
  assert.equal(sl[0].kind, 'superlike');
  assert.equal(sl[0].quantity, 5);
  assert.equal(Number(sl[0].price_eur), 4.99);
  assert.equal(sl[0].store_product_id, 'com.mbenguiste.superlike.5');

  const { rows: b } = await db.query(
    "select quantity from consumable_products where code = 'boost_10'",
  );
  assert.equal(b[0].quantity, 10);
});

test('RLS : chacun ne lit QUE ses propres crédits', async () => {
  const a = await addUser(db, { firstName: 'Awa' });
  const b = await addUser(db, { firstName: 'Bineta' });
  // Seed en tant que propriétaire (comme le ferait le backend en service_role).
  await db.query(
    'insert into user_credits (profile_id, superlike_balance, boost_balance) values ($1::uuid, 7, 2)',
    [a],
  );

  const mine = await asUser(db, a, () =>
    db.query('select superlike_balance, boost_balance from user_credits'));
  assert.equal(mine.rows.length, 1);
  assert.equal(mine.rows[0].superlike_balance, 7);

  const others = await asUser(db, b, () =>
    db.query('select * from user_credits'));
  assert.equal(others.rows.length, 0, 'B ne doit voir aucun crédit de A');
});

test('RLS : un client ne peut PAS se créditer lui-même (écriture bloquée)', async () => {
  const a = await addUser(db, { firstName: 'Chloé' });
  await assert.rejects(
    () => asUser(db, a, () =>
      db.query('insert into user_credits (profile_id, superlike_balance) values ($1::uuid, 999)', [a])),
    'aucune policy INSERT → écriture refusée par RLS',
  );
});

test('idempotence : une transaction store ne crédite qu\'une fois', async () => {
  const a = await addUser(db, { firstName: 'Diane' });
  const { rows: p } = await db.query(
    "select id, quantity from consumable_products where code = 'superlike_15'",
  );
  const productId = p[0].id;

  await db.query(
    `insert into consumable_purchases (profile_id, product_id, store_transaction_id, quantity)
     values ($1::uuid, $2::uuid, 'txn_ABC', $3)`,
    [a, productId, p[0].quantity],
  );

  await assert.rejects(
    () => db.query(
      `insert into consumable_purchases (profile_id, product_id, store_transaction_id, quantity)
       values ($1::uuid, $2::uuid, 'txn_ABC', $3)`,
      [a, productId, p[0].quantity],
    ),
    'la contrainte unique sur store_transaction_id doit rejeter le doublon',
  );
});
