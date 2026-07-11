'use strict';
// Le cœur du produit : le trigger mutual-like → match (db/schema.sql, section 6),
// testé sur le VRAI schéma dans un Postgres en mémoire. Si quelqu'un touche au
// trigger, à la contrainte d'unicité ou à l'ordre canonique, ça casse ICI —
// pas en prod devant les utilisatrices.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, swipe, matchesBetween, sendMessage } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });

test('un like sans réciproque ne crée pas de match', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  assert.equal((await matchesBetween(db, a, b)).length, 0);
});

test('like réciproque → UN match, en ordre canonique (user_low < user_high)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await swipe(db, b, a, 'like');
  const rows = await matchesBetween(db, a, b);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].user_low < rows[0].user_high, 'la paire doit être stockée triée');
  assert.equal(rows[0].is_active, true);
});

test('le super_like compte comme un like pour la réciprocité', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'super_like');
  await swipe(db, b, a, 'like');
  assert.equal((await matchesBetween(db, a, b)).length, 1);
});

test('un pass ne crée JAMAIS de match, même en réponse à un like', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await swipe(db, b, a, 'pass');
  assert.equal((await matchesBetween(db, a, b)).length, 0);
});

test('un like vers quelqu\'un qui a passé ne crée pas de match', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'pass');
  await swipe(db, b, a, 'like');
  assert.equal((await matchesBetween(db, a, b)).length, 0);
});

test('re-swiper la même personne est rejeté (clé primaire swiper+target)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await assert.rejects(() => swipe(db, a, b, 'super_like'));
});

test('s\'auto-swiper est rejeté (contrainte chk_no_self_swipe)', async () => {
  const a = await addUser(db);
  await assert.rejects(() => swipe(db, a, a, 'like'));
});

test('un nouveau message met à jour last_message_at du match (trigger)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await swipe(db, b, a, 'like');
  const [m] = await matchesBetween(db, a, b);

  const msg = await sendMessage(db, m.id, a, 'On se croise à Lisbonne ?');
  const res = await db.query('SELECT last_message_at FROM matches WHERE id = $1::uuid', [m.id]);
  assert.equal(
    new Date(res.rows[0].last_message_at).getTime(),
    new Date(msg.created_at).getTime(),
    'last_message_at doit suivre le dernier message (ordre de la liste des conversations)',
  );
});
