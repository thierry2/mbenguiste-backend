'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — table push_tokens (migration 037), contre le VRAI schema.sql.
//
// CE QUE LE MODÈLE EXIGE, et pourquoi :
//   · plusieurs tokens par compte — c'est TOUT l'objet de la table (avant, une
//     colonne unique rendait le premier téléphone muet dès qu'on se connectait
//     sur un second, sans rien dire) ;
//   · un token appartient à UN SEUL compte, et se RÉATTRIBUE — un même appareil
//     qui change de compte doit suivre le nouveau, sinon l'ancien propriétaire
//     reçoit les notifications de quelqu'un d'autre (fuite, pas juste un bug) ;
//   · suppression en cascade — un compte purgé ne laisse pas de tokens orphelins
//     vers lesquels on continuerait d'émettre.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db;
let alice;
let bob;

before(async () => {
  db = await createDb();
  alice = await addUser(db, 'alice@t.dev');
  bob = await addUser(db, 'bob@t.dev');
});

test('UN COMPTE, PLUSIEURS APPAREILS — c’est l’objet même de la table', async () => {
  await db.query(
    'INSERT INTO push_tokens (token, profile_id, platform) VALUES ($1, $2, $3), ($4, $2, $5)',
    ['ExponentPushToken[tel-1]', alice, 'android', 'ExponentPushToken[tel-2]', 'ios'],
  );
  const r = await db.query('SELECT token FROM push_tokens WHERE profile_id = $1', [alice]);
  assert.equal(r.rows.length, 2, 'les deux appareils cohabitent');
});

test('un token est UNIQUE — le même appareil ne s’inscrit pas deux fois', async () => {
  await assert.rejects(
    () => db.query('INSERT INTO push_tokens (token, profile_id) VALUES ($1, $2)',
      ['ExponentPushToken[tel-1]', alice]),
    /duplicate key|unique/i,
  );
});

test('RÉATTRIBUTION : un appareil qui change de compte suit le NOUVEAU', async () => {
  // Le cas qui compte vraiment : sans ça, Bob prête son téléphone à Alice, et
  // Bob continue de recevoir les notifications d'Alice.
  await db.query(
    `INSERT INTO push_tokens (token, profile_id) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET profile_id = EXCLUDED.profile_id, updated_at = now()`,
    ['ExponentPushToken[tel-1]', bob],
  );
  const r = await db.query('SELECT profile_id FROM push_tokens WHERE token = $1',
    ['ExponentPushToken[tel-1]']);
  assert.equal(r.rows.length, 1, 'toujours une seule ligne pour cet appareil');
  assert.equal(r.rows[0].profile_id, bob, 'le token a suivi le nouveau compte');
});

test('CASCADE : supprimer un profil efface ses tokens (aucun orphelin)', async () => {
  const carl = await addUser(db, 'carl@t.dev');
  await db.query('INSERT INTO push_tokens (token, profile_id) VALUES ($1, $2)',
    ['ExponentPushToken[carl]', carl]);
  await db.query('DELETE FROM profiles WHERE id = $1', [carl]);
  const r = await db.query('SELECT token FROM push_tokens WHERE token = $1',
    ['ExponentPushToken[carl]']);
  assert.equal(r.rows.length, 0);
});

test('un token sans compte est REFUSÉ — on n’émet jamais vers personne', async () => {
  await assert.rejects(
    () => db.query('INSERT INTO push_tokens (token, profile_id) VALUES ($1, NULL)',
      ['ExponentPushToken[orphelin]']),
    /null value|not-null/i,
  );
});
