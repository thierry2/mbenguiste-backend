'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB de pending_likes (migration 020) — l'agrégat TEMPS RÉEL des likes
// reçus non répondus, maintenu par triggers (comme le match mutuel). Remplace le
// `NOT IN (tous mes swipes)` de likersPending par un simple `where target_id`.
// Invariant : pending_likes(T, S) existe  ⟺  S a liké/super-liké T
//             ET T n'a pas encore swipé S  ET aucun blocage entre eux.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, swipe, matchesBetween, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

async function pendingOf(target) {
  const { rows } = await db.query(
    'select swiper_id, action_code from pending_likes where target_id = $1::uuid order by created_at desc',
    [target],
  );
  return rows;
}
async function block(blocker, blocked) {
  await db.query('insert into blocks (blocker_id, blocked_id) values ($1::uuid, $2::uuid)', [blocker, blocked]);
}

test('like : le likeur apparaît dans les pending de la cible', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  const p = await pendingOf(b);
  assert.equal(p.length, 1);
  assert.equal(p[0].swiper_id, a);
  assert.equal(p[0].action_code, 'like');
  assert.equal((await pendingOf(a)).length, 0, 'à sens unique : A n\'a rien reçu');
});

test('super_like : action_code = super_like (→ épinglé en tête de liste côté UI)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'super_like');
  assert.equal((await pendingOf(b))[0].action_code, 'super_like');
});

test('pass : ne crée aucun pending', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'pass');
  assert.equal((await pendingOf(b)).length, 0);
});

test('réponse : quand la cible swipe le likeur, le pending disparaît', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');           // A like B → pending pour B
  assert.equal((await pendingOf(b)).length, 1);
  await swipe(db, b, a, 'pass');           // B répond (pass) → pending consommé
  assert.equal((await pendingOf(b)).length, 0, 'B a répondu → A quitte ses pending');
});

test('match mutuel : aucun pending des deux côtés + le match existe', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');           // A like B
  await swipe(db, b, a, 'like');           // B like A → MATCH
  assert.equal((await pendingOf(a)).length, 0, 'match → pas de pending côté A');
  assert.equal((await pendingOf(b)).length, 0, 'match → pas de pending côté B');
  assert.equal((await matchesBetween(db, a, b)).length, 1);
});

test('like APRÈS que la cible a déjà passé : pas de pending fantôme', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, b, a, 'pass');           // B a déjà répondu à A (avant même le like)
  await swipe(db, a, b, 'like');           // A like B
  // B a swipé A → A ne doit pas être en pending pour B.
  assert.equal((await pendingOf(b)).length, 0);
});

test('blocage : retire les pending dans les deux sens', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');           // A like B → pending pour B
  await block(b, a);                        // B bloque A
  assert.equal((await pendingOf(b)).length, 0, 'un bloqué ne reste pas dans les pending');
});

test('blocage inverse : retire aussi (peu importe qui bloque)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  await block(a, b);                        // A bloque B
  assert.equal((await pendingOf(b)).length, 0);
});

test('RLS : un client ne lit ni n\'écrit pending_likes', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like');
  const read = await asUser(db, b, () => db.query('select * from pending_likes'));
  assert.equal(read.rows.length, 0, 'agrégat serveur, opaque au client');
  await assert.rejects(
    () => asUser(db, b, () => db.query('insert into pending_likes (target_id, swiper_id, action_code) values ($1::uuid,$1::uuid,\'like\')', [b])),
  );
});
