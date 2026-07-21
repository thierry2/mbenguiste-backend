'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — la SORTIE PROPRE (« terminer le mystère »).
//
// Bug 21/07 : l'état 'left' manquait à la contrainte CHECK de mystere_pairs.
// `etatApresIssue('left')` renvoie 'left' et `revealAndMatch`/`leaveMystere`
// écrivent `state = 'left'` — mais la contrainte le REJETAIT. Pire, l'erreur de
// l'update était avalée : la paire restait 'active' → les DEUX membres verrouillés
// à vie (le trigger « un seul mystère actif » leur interdisait toute nouvelle
// paire). On fige ici, contre le vrai schema.sql :
//   · 'left' est un état ACCEPTÉ par la contrainte ;
//   · une paire passée 'left' LIBÈRE ses deux membres (plus non terminale), donc
//     le trigger laisse re-créer un mystère pour eux.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db, low, high;
const ordered = (x, y) => (x < y ? [x, y] : [y, x]);

before(async () => {
  db = await createDb();
  const a = await addUser(db, { firstName: 'Awa' });
  const b = await addUser(db, { firstName: 'Bakary' });
  [low, high] = ordered(a, b);
});

test("l'état 'left' est ACCEPTÉ par la contrainte (sortie propre)", async () => {
  const id = (await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'active') RETURNING id`, [low, high],
  )).rows[0].id;
  // Ce que fait leaveMystere : active → left. NE DOIT PAS lever.
  await assert.doesNotReject(db.query(
    "UPDATE mystere_pairs SET state = 'left' WHERE id = $1::uuid", [id],
  ));
  const row = (await db.query('SELECT state FROM mystere_pairs WHERE id = $1::uuid', [id])).rows[0];
  assert.equal(row.state, 'left');
});

test("une paire 'left' LIBÈRE ses membres (plus non terminale, re-mystère possible)", async () => {
  // pairForUser ne regarde que proposed/active : après 'left', plus rien.
  const res = await db.query(
    `SELECT id FROM mystere_pairs
     WHERE state IN ('proposed','active') AND (user_low = $1::uuid OR user_high = $1::uuid)`,
    [low],
  );
  assert.equal(res.rows.length, 0);

  // Et le trigger « un seul actif » laisse re-créer une paire pour ce membre.
  const c = await addUser(db, { firstName: 'Coura' });
  const [l2, h2] = ordered(low, c);
  await assert.doesNotReject(db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'proposed')`, [l2, h2],
  ));
});
