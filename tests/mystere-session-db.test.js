'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — l'I/O de session que le service de résolution exige (au-delà de
// l'anonymat, couvert par mystere-db.test.js). On fige ici, contre le VRAI
// schema.sql, exactement les opérations SQL que `mystere.model` émet :
//   · `tours_desaccord` : la mémoire de la boucle de désaccord (défaut 0, MàJ) ;
//   · UPSERT (session,node,role) : répondre deux fois écrase, ne duplique pas ;
//   · effacement par nœud : rejouer une question repart propre, sans toucher
//     aux autres nœuds.
// Sans ces garanties, `advanceSession`/`recordAnswer` marcheraient « en test »
// (fakes) mais casseraient en prod. C'est ce trou-là qu'on ferme.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db, pairId, sessionId;
const ordered = (x, y) => (x < y ? [x, y] : [y, x]);

before(async () => {
  db = await createDb();
  const a = await addUser(db, { firstName: 'Awa' });
  const b = await addUser(db, { firstName: 'Bakary' });
  const [low, high] = ordered(a, b);
  pairId = (await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'active') RETURNING id`, [low, high],
  )).rows[0].id;
  sessionId = (await db.query(
    `INSERT INTO aventure_sessions (pair_id, graph_id, current_node)
     VALUES ($1::uuid, 'grotte-ci', 'n2') RETURNING id`, [pairId],
  )).rows[0].id;
});

test('tours_desaccord : défaut 0, puis incrémenté (la boucle a une mémoire)', async () => {
  const init = await db.query('SELECT tours_desaccord FROM aventure_sessions WHERE id = $1::uuid', [sessionId]);
  assert.equal(init.rows[0].tours_desaccord, 0);

  await db.query(
    "UPDATE aventure_sessions SET tours_desaccord = 1, current_node = 'n2' WHERE id = $1::uuid",
    [sessionId],
  );
  const apres = await db.query('SELECT tours_desaccord FROM aventure_sessions WHERE id = $1::uuid', [sessionId]);
  assert.equal(apres.rows[0].tours_desaccord, 1);
});

test('UPSERT (session,node,role) : répondre deux fois ÉCRASE, ne duplique pas', async () => {
  const up = (idx) => db.query(
    `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
     VALUES ($1::uuid, 'n2', 'a', $2)
     ON CONFLICT (session_id, node_id, role)
     DO UPDATE SET answer_index = EXCLUDED.answer_index`,
    [sessionId, idx],
  );
  await up(0);
  await up(1); // reconnexion / double-tap : même rôle, même nœud

  const r = await db.query(
    "SELECT answer_index FROM aventure_answers WHERE session_id = $1::uuid AND node_id = 'n2' AND role = 'a'",
    [sessionId],
  );
  assert.equal(r.rows.length, 1);          // une seule ligne
  assert.equal(r.rows[0].answer_index, 1); // la dernière gagne
});

test('les deux rôles cohabitent sur un nœud (ce que lit answersForNode)', async () => {
  await db.query(
    `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
     VALUES ($1::uuid, 'n2', 'b', 1)
     ON CONFLICT (session_id, node_id, role) DO UPDATE SET answer_index = EXCLUDED.answer_index`,
    [sessionId],
  );
  const r = await db.query(
    "SELECT role, answer_index FROM aventure_answers WHERE session_id = $1::uuid AND node_id = 'n2' ORDER BY role",
    [sessionId],
  );
  assert.deepEqual(r.rows.map((x) => x.role), ['a', 'b']);
});

test('effacement PAR NŒUD : rejouer une question repart propre, les autres nœuds intacts', async () => {
  // Une réponse sur un AUTRE nœud, qui ne doit PAS être touchée.
  await db.query(
    `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
     VALUES ($1::uuid, 'n3', 'a', 0)`, [sessionId],
  );

  // advanceSession(..., clearAnswers) efface les réponses DU nœud courant (n2).
  await db.query("DELETE FROM aventure_answers WHERE session_id = $1::uuid AND node_id = 'n2'", [sessionId]);

  const n2 = await db.query("SELECT 1 FROM aventure_answers WHERE session_id = $1::uuid AND node_id = 'n2'", [sessionId]);
  assert.equal(n2.rows.length, 0);         // n2 nettoyé
  const n3 = await db.query("SELECT 1 FROM aventure_answers WHERE session_id = $1::uuid AND node_id = 'n3'", [sessionId]);
  assert.equal(n3.rows.length, 1);         // n3 intact
});

test('outcome remis à null (ce que fait le Joker) est accepté', async () => {
  await db.query("UPDATE aventure_sessions SET outcome = 'echec' WHERE id = $1::uuid", [sessionId]);
  await db.query('UPDATE aventure_sessions SET outcome = null, joker_used = true WHERE id = $1::uuid', [sessionId]);
  const r = await db.query('SELECT outcome, joker_used FROM aventure_sessions WHERE id = $1::uuid', [sessionId]);
  assert.equal(r.rows[0].outcome, null);
  assert.equal(r.rows[0].joker_used, true);
});
