'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB des réglages à chaud (migration 019, reflétée dans schema.sql) :
//  - app_settings (clé → valeur jsonb) : le calibrage matching/ranking se change
//    par un UPDATE SQL, effet en ~60 s (cache), SANS redéploiement ni MAJ appli ;
//  - les leviers de lancement sont seedés à leurs défauts sûrs ;
//  - RLS : FERMÉ au client (lecture + écriture backend service_role only — un
//    réglage global ne se lit ni ne se force depuis l'appli).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

test('seed : les leviers de matching existent à leurs défauts', async () => {
  const { rows } = await db.query(
    "select key, value from app_settings where key in ('deck.admirer_ratio','deck.admirer_cap','ranking.reciprocity_weight') order by key",
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(map['deck.admirer_ratio'], 0.5);
  assert.equal(map['deck.admirer_cap'], 6);
  assert.equal(map['ranking.reciprocity_weight'], 15);
});

test('valeur jsonb : accepte nombre, booléen, objet (calibrage libre)', async () => {
  await db.query("insert into app_settings (key, value) values ('t.num', '3.2'::jsonb), ('t.bool', 'true'::jsonb), ('t.obj', '{\"a\":1}'::jsonb)");
  const { rows } = await db.query("select key, value from app_settings where key like 't.%' order by key");
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(map['t.bool'], true);
  assert.equal(map['t.num'], 3.2);
  assert.deepEqual(map['t.obj'], { a: 1 });
});

test('upsert : le backend écrase un réglage (on conflict do update)', async () => {
  await db.query(
    "insert into app_settings (key, value) values ('deck.admirer_ratio', '0.2'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()",
  );
  const { rows } = await db.query("select value from app_settings where key = 'deck.admirer_ratio'");
  assert.equal(rows[0].value, 0.2);
});

test('RLS : un client ne LIT rien (le calibrage global est opaque)', async () => {
  const u = await addUser(db);
  const r = await asUser(db, u, () => db.query('select * from app_settings'));
  assert.equal(r.rows.length, 0);
});

test('RLS : un client ne peut PAS écrire un réglage', async () => {
  const u = await addUser(db);
  await assert.rejects(
    () => asUser(db, u, () => db.query("insert into app_settings (key, value) values ('hack', '1'::jsonb)")),
    'aucune policy INSERT → refus RLS',
  );
});
