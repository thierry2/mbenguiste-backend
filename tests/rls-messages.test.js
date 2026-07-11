'use strict';
// RLS du chat (db/schema.sql, section 7) — c'est CES policies qui font que le
// Realtime livre les messages au bon destinataire et à personne d'autre
// (doctrine AfrikMoms : pas de filtre serveur fiable → la sécurité EST la RLS).
// Testé pour de vrai : SET ROLE authenticated + auth.uid() factice (cf. helpers/db).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, swipe, matchesBetween, sendMessage, asUser } = require('./helpers/db');

let db;
let alice, bob, eve;   // alice ♥ bob (match) ; eve = étrangère au match
let matchId;

before(async () => {
  db = await createDb();
  alice = await addUser(db, { firstName: 'Alice' });
  bob = await addUser(db, { firstName: 'Bob' });
  eve = await addUser(db, { firstName: 'Eve' });
  await swipe(db, alice, bob, 'like');
  await swipe(db, bob, alice, 'like');
  matchId = (await matchesBetween(db, alice, bob))[0].id;
  await sendMessage(db, matchId, alice, 'Premier message');
});

test('un membre du match lit les messages du fil', async () => {
  const rows = await asUser(db, bob, async () => {
    const res = await db.query('SELECT body FROM messages WHERE match_id = $1::uuid', [matchId]);
    return res.rows;
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, 'Premier message');
});

test('une étrangère au match ne voit AUCUN message (même en connaissant le match_id)', async () => {
  const rows = await asUser(db, eve, async () => {
    const res = await db.query('SELECT body FROM messages WHERE match_id = $1::uuid', [matchId]);
    return res.rows;
  });
  assert.equal(rows.length, 0);
});

test('un membre écrit dans son match actif', async () => {
  await asUser(db, bob, () =>
    db.query(
      'INSERT INTO messages (match_id, sender_id, body) VALUES ($1::uuid, $2::uuid, $3)',
      [matchId, bob, 'Réponse de Bob'],
    ));
  const res = await db.query("SELECT 1 FROM messages WHERE body = 'Réponse de Bob'");
  assert.equal(res.rows.length, 1);
});

test('une étrangère ne peut pas écrire dans le match', async () => {
  await assert.rejects(() =>
    asUser(db, eve, () =>
      db.query(
        'INSERT INTO messages (match_id, sender_id, body) VALUES ($1::uuid, $2::uuid, $3)',
        [matchId, eve, 'Intrusion'],
      )));
});

test('usurper le sender_id d\'un autre membre est rejeté', async () => {
  await assert.rejects(() =>
    asUser(db, bob, () =>
      db.query(
        'INSERT INTO messages (match_id, sender_id, body) VALUES ($1::uuid, $2::uuid, $3)',
        [matchId, alice, 'Faux message d\'Alice'],
      )));
});

test('écrire dans un match désactivé (unmatch/blocage) est rejeté', async () => {
  await db.query('UPDATE matches SET is_active = false WHERE id = $1::uuid', [matchId]);
  await assert.rejects(() =>
    asUser(db, bob, () =>
      db.query(
        'INSERT INTO messages (match_id, sender_id, body) VALUES ($1::uuid, $2::uuid, $3)',
        [matchId, bob, 'Message post-unmatch'],
      )));
  await db.query('UPDATE matches SET is_active = true WHERE id = $1::uuid', [matchId]);
});

test('chacun ne voit que SES matchs', async () => {
  const mineAsEve = await asUser(db, eve, async () => {
    const res = await db.query('SELECT id FROM matches');
    return res.rows;
  });
  assert.equal(mineAsEve.length, 0, 'Eve n\'a aucun match, elle ne doit rien voir');

  const mineAsAlice = await asUser(db, alice, async () => {
    const res = await db.query('SELECT id FROM matches');
    return res.rows;
  });
  assert.equal(mineAsAlice.length, 1);
});

test('les profils supprimés (soft delete) sont invisibles côté client', async () => {
  const ghost = await addUser(db, { firstName: 'Fantôme' });
  await db.query('UPDATE profiles SET deleted_at = now() WHERE id = $1::uuid', [ghost]);
  const rows = await asUser(db, alice, async () => {
    const res = await db.query('SELECT id FROM profiles WHERE id = $1::uuid', [ghost]);
    return res.rows;
  });
  assert.equal(rows.length, 0);
});
