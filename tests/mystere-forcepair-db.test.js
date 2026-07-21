'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — l'outil de test admin `forcePair` (POST /admin/mystere/pair).
// Il insère une paire 'proposed' ordonnée (low<high) SANS passer par la passe,
// pour tester la vraie chaîne à deux. On fige, contre le vrai schema.sql :
//   · la paire forcée s'insère et est ordonnée (chk_pair_order tient) ;
//   · le trigger « un seul mystère actif » refuse une 2ᵉ paire qui réutilise l'un
//     des deux (exactement ce que `forcePair` remonte comme erreur à l'admin).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db, a, b, c;
const ordered = (x, y) => (x < y ? [x, y] : [y, x]);

before(async () => {
  db = await createDb();
  a = await addUser(db, { firstName: 'Awa' });
  b = await addUser(db, { firstName: 'Bakary' });
  c = await addUser(db, { firstName: 'Coura' });
});

test('forcePair : insère une paire proposed ordonnée (low<high)', async () => {
  const [low, high] = ordered(a, b);
  const row = (await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'proposed')
     RETURNING id, user_low, user_high, state`, [low, high],
  )).rows[0];
  assert.equal(row.state, 'proposed');
  assert.ok(row.user_low < row.user_high);
});

test('forcePair : une 2ᵉ paire réutilisant un membre est REFUSÉE (un seul actif)', async () => {
  const [low, high] = ordered(a, c); // `a` est déjà pris par la paire ci-dessus
  await assert.rejects(db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'proposed')`, [low, high],
  ), /actif/);
});
