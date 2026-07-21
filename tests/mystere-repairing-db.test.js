'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — DEUX PERSONNES PEUVENT SE RECROISER.
//
// Bug trouvé le 21/07 : `mystere_pairs` portait `unique (user_low, user_high)`
// SANS condition d'état. La ligne d'un mystère TERMINÉ restait donc en base et
// interdisait à jamais toute nouvelle paire entre ces deux personnes.
//
// Deux dégâts :
//   · en test, `forcePair` échouait dès la 2e tentative sur les mêmes comptes —
//     il fallait supprimer la ligne à la main entre chaque essai à 2 téléphones ;
//   · en production, la passe d'appariement écartait silencieusement un couple
//     compatible parce qu'ils s'étaient croisés une fois. Invisible : aucune
//     erreur, juste un candidat qui n'apparaît jamais.
//
// La migration 036 rend l'unicité PARTIELLE (paires vivantes seulement). On fige
// ici, contre le vrai schema.sql, les DEUX moitiés de la règle : l'historique ne
// bloque plus rien, mais un duo ne peut toujours pas avoir deux mystères vivants.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db, low, high;
const ordered = (x, y) => (x < y ? [x, y] : [y, x]);

const creer = (etat) => db.query(
  `INSERT INTO mystere_pairs (user_low, user_high, state)
   VALUES ($1::uuid, $2::uuid, $3) RETURNING id`, [low, high, etat],
);

before(async () => {
  db = await createDb();
  const a = await addUser(db, { firstName: 'Awa' });
  const b = await addUser(db, { firstName: 'Bakary' });
  [low, high] = ordered(a, b);
});

beforeEach(async () => { await db.query('DELETE FROM mystere_pairs'); });

// ── L'historique ne bloque plus l'avenir ────────────────────────────────────
for (const terminal of ['won', 'lost', 'left', 'dissolved']) {
  test(`un mystère '${terminal}' n'empêche PAS d'en refaire un ensemble`, async () => {
    await creer(terminal);
    await assert.doesNotReject(creer('proposed'));
    const n = (await db.query(
      'SELECT count(*)::int AS n FROM mystere_pairs WHERE user_low = $1::uuid', [low],
    )).rows[0].n;
    assert.equal(n, 2, 'les deux lignes coexistent : l’historique + la nouvelle');
  });
}

test('trois mystères terminés puis un neuf : rien ne bloque', async () => {
  await creer('won');
  await creer('left');
  await creer('dissolved');
  await assert.doesNotReject(creer('proposed'));
});

// ── Mais un duo n'a jamais DEUX mystères vivants ────────────────────────────
test('deux paires VIVANTES pour le même duo restent INTERDITES', async () => {
  await creer('proposed');
  await assert.rejects(creer('active'), 'un duo ne peut pas avoir deux mystères en cours');
});

test('une paire vivante libère la place une fois terminée', async () => {
  const id = (await creer('active')).rows[0].id;
  await db.query("UPDATE mystere_pairs SET state = 'won' WHERE id = $1::uuid", [id]);
  await assert.doesNotReject(creer('proposed'));
});
