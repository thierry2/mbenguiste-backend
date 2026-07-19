'use strict';
// Vérification par selfie — contrats DB (migration 030) sur le VRAI schema.sql :
//  • table verification_requests + contrainte de statut ;
//  • index unique partiel : au plus UNE requête active par personne ;
//  • FK on delete cascade (supprimer le profil efface ses demandes) ;
//  • colonne profiles.verified_at (audit du sceau).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });

async function insertRequest(db, userId, status = 'awaiting_selfie', poseCode = 'main_sur_tete') {
  return db.query(
    `insert into verification_requests (user_id, pose_code, status)
     values ($1::uuid, $2, $3) returning id`,
    [userId, poseCode, status],
  );
}

test('verification_requests accepte une demande valide', async () => {
  const u = await addUser(db);
  const res = await insertRequest(db, u);
  assert.equal(res.rows.length, 1);
});

test('contrainte de statut : un statut hors liste est refusé', async () => {
  const u = await addUser(db);
  await assert.rejects(insertRequest(db, u, 'n_importe_quoi'));
});

test('index unique partiel : impossible d\'avoir 2 requêtes ACTIVES pour la même personne', async () => {
  const u = await addUser(db);
  await insertRequest(db, u, 'awaiting_selfie');
  // pending_review compte aussi comme active → doit être refusé.
  await assert.rejects(insertRequest(db, u, 'pending_review'));
});

test('une requête close libère la place : on peut en rouvrir une', async () => {
  const u = await addUser(db);
  const { rows } = await insertRequest(db, u, 'awaiting_selfie');
  await db.query("update verification_requests set status = 'rejected' where id = $1::uuid", [rows[0].id]);
  // La place est libre → une nouvelle demande active passe.
  await assert.doesNotReject(insertRequest(db, u, 'awaiting_selfie'));
});

test('deux personnes peuvent avoir chacune une requête active', async () => {
  const a = await addUser(db);
  const b = await addUser(db);
  await assert.doesNotReject(insertRequest(db, a));
  await assert.doesNotReject(insertRequest(db, b));
});

test('FK on delete cascade : supprimer le profil efface ses demandes', async () => {
  const u = await addUser(db);
  await insertRequest(db, u);
  await db.query('delete from profiles where id = $1::uuid', [u]);
  const res = await db.query('select id from verification_requests where user_id = $1::uuid', [u]);
  assert.equal(res.rows.length, 0);
});

test('profiles.verified_at existe et vaut null par défaut', async () => {
  const u = await addUser(db);
  const res = await db.query('select verified_at from profiles where id = $1::uuid', [u]);
  assert.equal(res.rows[0].verified_at, null);
});
