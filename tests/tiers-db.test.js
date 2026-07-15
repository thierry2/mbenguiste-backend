'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB des paliers & grants (migration 016, reflétée dans schema.sql) :
//  - profiles.premium_tier : contrainte de valeurs (plus/or/prestige/null) ;
//  - user_credits.joker_balance : présent, défaut 0 ;
//  - recurring_grants : une clé (profil × kind × période) = UN seul grant
//    (c'est la PK qui porte l'idempotence anti double-versement) ;
//  - RLS : chacun lit ses propres grants, personne ne s'en écrit.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

test('profiles.premium_tier : accepte les 3 paliers et null, rejette le reste', async () => {
  const a = await addUser(db, { firstName: 'Fatou' });
  for (const tier of ['plus', 'or', 'prestige', null]) {
    await db.query('update profiles set premium_tier = $1 where id = $2::uuid', [tier, a]);
  }
  await assert.rejects(
    () => db.query("update profiles set premium_tier = 'diamant' where id = $1::uuid", [a]),
    'la contrainte check doit rejeter un palier inconnu',
  );
});

test('user_credits.joker_balance : présent, défaut 0', async () => {
  const a = await addUser(db, { firstName: 'Grace' });
  await db.query('insert into user_credits (profile_id) values ($1::uuid)', [a]);
  const { rows } = await db.query(
    'select superlike_balance, boost_balance, joker_balance from user_credits where profile_id = $1::uuid', [a],
  );
  assert.equal(rows[0].joker_balance, 0);
});

test('recurring_grants : la PK (profil, kind, période) déduplique', async () => {
  const a = await addUser(db, { firstName: 'Hawa' });
  await db.query(
    "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'superlike', '2026-W29')", [a],
  );
  // Même période → rejeté (c'est ce que claim() exploite avec on conflict do nothing).
  await assert.rejects(
    () => db.query(
      "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'superlike', '2026-W29')", [a],
    ),
  );
  // Autre période, autre kind : passent.
  await db.query(
    "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'superlike', '2026-W30')", [a],
  );
  await db.query(
    "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'boost', '2026-07')", [a],
  );
  const { rows } = await db.query(
    'select count(*)::int as n from recurring_grants where profile_id = $1::uuid', [a],
  );
  assert.equal(rows[0].n, 3);
});

test('RLS recurring_grants : chacun lit les siens, personne ne s\'écrit un grant', async () => {
  const a = await addUser(db, { firstName: 'Inna' });
  const b = await addUser(db, { firstName: 'Jade' });
  await db.query(
    "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'boost', '2026-07')", [a],
  );

  const mine = await asUser(db, a, () => db.query('select kind from recurring_grants'));
  assert.equal(mine.rows.length, 1);

  const others = await asUser(db, b, () => db.query('select * from recurring_grants'));
  assert.equal(others.rows.length, 0, 'B ne voit pas les grants de A');

  await assert.rejects(
    () => asUser(db, b, () => db.query(
      "insert into recurring_grants (profile_id, kind, period_key) values ($1::uuid, 'joker', '2026-W29')", [b],
    )),
    'aucune policy INSERT → un client ne se granterait jamais lui-même',
  );
});

test('backfill : is_premium=true sans tier → premium_tier=or (rejoué sans effet de bord)', async () => {
  const a = await addUser(db, { firstName: 'Khady' });
  const b = await addUser(db, { firstName: 'Lea' });
  await db.query('update profiles set is_premium = true, premium_tier = null where id = $1::uuid', [a]);
  await db.query("update profiles set is_premium = true, premium_tier = 'prestige' where id = $1::uuid", [b]);

  // La requête de backfill de la migration 016, verbatim.
  const BACKFILL = "update profiles set premium_tier = 'or' where is_premium = true and premium_tier is null";
  await db.query(BACKFILL);
  await db.query(BACKFILL); // idempotent

  const { rows: ra } = await db.query('select premium_tier from profiles where id = $1::uuid', [a]);
  assert.equal(ra[0].premium_tier, 'or');
  const { rows: rb } = await db.query('select premium_tier from profiles where id = $1::uuid', [b]);
  assert.equal(rb[0].premium_tier, 'prestige', 'un tier déjà posé n\'est jamais écrasé');
});
