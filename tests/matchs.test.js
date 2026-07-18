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

// ── Changement d'avis via UPSERT (même bug que le « like fantôme » 022, côté match) ──
// Le backend swipe TOUJOURS en upsert (swipe.model.record) : re-swiper une paire
// UPDATE la ligne. Le helper `swipe` du harnais fait un INSERT simple → on
// reproduit ici le vrai upsert pour tester le trigger sur changement d'avis.
async function reSwipe(swiper, target, action) {
  await db.query(
    `insert into swipes (swiper_id, target_id, action_id)
     values ($1::uuid, $2::uuid, (select id from swipe_actions where code = $3))
     on conflict (swiper_id, target_id)
       do update set action_id = excluded.action_id, created_at = now()`,
    [swiper, target, action],
  );
}
async function block(blocker, blocked) {
  await db.query('insert into blocks (blocker_id, blocked_id) values ($1::uuid, $2::uuid)', [blocker, blocked]);
}

test('pass puis re-like (UPSERT) face à un like en attente : le match se crée', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, b, a, 'like');            // B aime A (en attente)
  await swipe(db, a, b, 'pass');            // A passe B
  assert.equal((await matchesBetween(db, a, b)).length, 0);
  await reSwipe(a, b, 'like');              // A se ravise (UPDATE, pas INSERT)
  const rows = await matchesBetween(db, a, b);
  assert.equal(rows.length, 1, 'le like réciproque via UPSERT doit créer le match');
  assert.equal(rows[0].is_active, true);
});

test('unmatch puis re-like (UPSERT) : le MÊME match se réactive', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await swipe(db, b, a, 'like');            // match
  const [m] = await matchesBetween(db, a, b);
  await db.query('update matches set is_active = false where id = $1::uuid', [m.id]); // unmatch
  await reSwipe(a, b, 'like');              // un re-like frais (UPDATE idempotent)
  const rows = await matchesBetween(db, a, b);
  assert.equal(rows.length, 1, 'toujours UNE seule ligne pour la paire');
  assert.equal(rows[0].id, m.id, 'même fil de conversation');
  assert.equal(rows[0].is_active, true, 'le re-like réactive le match');
});

test('après un block, un re-like ne ressuscite JAMAIS le match', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await swipe(db, b, a, 'like');            // match
  await block(a, b);                        // A bloque B (moderation coupe aussi is_active)
  await db.query('update matches set is_active = false where user_low = least($1::uuid,$2::uuid) and user_high = greatest($1::uuid,$2::uuid)', [a, b]);
  await reSwipe(b, a, 'like');              // B re-like (il ne devrait même pas pouvoir)
  const rows = await matchesBetween(db, a, b);
  assert.equal(rows[0].is_active, false, 'un match coupé par un block reste mort');
});

test('un like vers une paire bloquée ne crée aucun match', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await block(a, b);                        // A a bloqué B avant tout match
  await swipe(db, b, a, 'like');
  await swipe(db, a, b, 'like');            // réciproque, mais paire bloquée
  assert.equal((await matchesBetween(db, a, b)).length, 0, 'pas de match entre bloqués');
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
