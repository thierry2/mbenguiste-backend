'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — table aventure_graphs (migration 032), contre le VRAI schema.sql.
// Ce que le modèle exige : upsert par id (ré-enregistrer ÉCRASE), jsonb qui
// restitue la structure intacte, et fermeture au client (aucune policy → RLS
// bloque tout accès authenticated).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;

before(async () => { db = await createDb(); });

test('upsert par id : ré-enregistrer un graphe ÉCRASE (pas de doublon)', async () => {
  const g1 = JSON.stringify({ start: 'n1', nodes: { n1: { kind: 'end', end: 'match' } } });
  await db.query(
    `INSERT INTO aventure_graphs (id, title, data) VALUES ('grotte-ci', 'v1', $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data`,
    [g1],
  );
  const g2 = JSON.stringify({ start: 'n1', nodes: { n1: { kind: 'epreuve' }, fin: { kind: 'end', end: 'echec' } } });
  await db.query(
    `INSERT INTO aventure_graphs (id, title, data) VALUES ('grotte-ci', 'v2', $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data`,
    [g2],
  );

  const r = await db.query('SELECT title, data FROM aventure_graphs WHERE id = $1', ['grotte-ci']);
  assert.equal(r.rows.length, 1);           // une seule ligne
  assert.equal(r.rows[0].title, 'v2');      // la dernière gagne
  assert.equal(r.rows[0].data.nodes.fin.end, 'echec'); // jsonb restitué intact
});

test('FERMÉE au client : un utilisateur authentifié ne lit RIEN', async () => {
  const u = await addUser(db, { firstName: 'Awa' });
  const rows = await asUser(db, u, async () => {
    const r = await db.query('SELECT id FROM aventure_graphs');
    return r.rows;
  });
  assert.equal(rows.length, 0); // aucune policy → RLS bloque tout
});
