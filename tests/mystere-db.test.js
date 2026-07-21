'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// CONTRAT DB — Mystère & Aventure (migration 031), joué contre le VRAI
// db/schema.sql (PGlite + auth.uid() factice + SET ROLE authenticated).
//
// Ce qu'on VÉRIFIE, et surtout l'ANONYMAT — l'invariant qui gouverne tout :
//   · le client ne peut JAMAIS lire mystere_pairs (donc jamais l'id du
//     partenaire) ;
//   · les deux joueurs lisent leur session et leurs réponses en Realtime, mais
//     les réponses ne portent qu'un RÔLE ('a'/'b'), jamais un profile_id ;
//   · un tiers ne voit rien de la session ni des réponses ;
//   · on ne peut pas usurper le rôle de l'autre en écrivant ;
//   · « un seul mystère à la fois » est tenu par la base, pas juste par le job.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;
let a, b, c;          // a & b sont le mystère l'un de l'autre ; c est étranger
let pairId, sessionId;

// Deux profils ordonnés user_low < user_high (contrainte de la table).
function ordered(x, y) { return x < y ? [x, y] : [y, x]; }

before(async () => {
  db = await createDb();
  a = await addUser(db, { firstName: 'Awa' });
  b = await addUser(db, { firstName: 'Bakary' });
  c = await addUser(db, { firstName: 'Chris' });

  const [low, high] = ordered(a, b);
  // Le backend (service_role ici = superuser du test) crée la paire + la session.
  pairId = (await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'active') RETURNING id`,
    [low, high],
  )).rows[0].id;
  sessionId = (await db.query(
    `INSERT INTO aventure_sessions (pair_id, graph_id, current_node)
     VALUES ($1::uuid, 'grotte-ci', 'n1') RETURNING id`,
    [pairId],
  )).rows[0].id;
});

// ── Anonymat de l'appariement ────────────────────────────────────────────────

test('ANONYMAT : un membre ne peut PAS lire mystere_pairs (jamais l’id du partenaire)', async () => {
  const rows = await asUser(db, a, async () => {
    const r = await db.query('SELECT * FROM mystere_pairs WHERE id = $1::uuid', [pairId]);
    return r.rows;
  });
  assert.equal(rows.length, 0); // fermée : aucune policy
});

// ── La session : les deux membres, et eux seuls ──────────────────────────────

test('les DEUX membres lisent leur session', async () => {
  for (const who of [a, b]) {
    const rows = await asUser(db, who, async () => {
      const r = await db.query('SELECT current_node FROM aventure_sessions WHERE id = $1::uuid', [sessionId]);
      return r.rows;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].current_node, 'n1');
  }
});

test('un TIERS ne voit pas la session, même en connaissant son id', async () => {
  const rows = await asUser(db, c, async () => {
    const r = await db.query('SELECT 1 FROM aventure_sessions WHERE id = $1::uuid', [sessionId]);
    return r.rows;
  });
  assert.equal(rows.length, 0);
});

// ── Les réponses : le canal Realtime, anonyme ────────────────────────────────
//
// CERVEAU UNIQUE (035) : le client ne SCRIT plus jamais `aventure_answers`
// directement — toute réponse passe par POST /discovery/mystere/answer
// (service_role, qui refiltre le message intime ET applique la résolution
// autoritaire). Les lignes ci-dessous sont donc écrites comme le fait le
// BACKEND (service_role = superuser du test, pas `asUser`) ; ce qu'on VÉRIFIE
// ici, c'est que le client peut toujours LIRE (Realtime) mais plus ÉCRIRE.

test('le backend écrit sous CHAQUE rôle, et les deux membres le LISENT', async () => {
  // a = user_low = rôle 'a' ; b = user_high = rôle 'b'.
  const [low] = ordered(a, b);
  const roleA = low === a ? 'a' : 'b';
  const roleB = roleA === 'a' ? 'b' : 'a';

  await db.query(
    `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
     VALUES ($1::uuid, 'n1', $2, 0)`, [sessionId, roleA],
  );
  await db.query(
    `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
     VALUES ($1::uuid, 'n1', $2, 1)`, [sessionId, roleB],
  );

  // b LIT les deux réponses (c'est ce que Realtime lui livrera)…
  const vues = await asUser(db, b, async () => {
    const r = await db.query(
      'SELECT role, answer_index FROM aventure_answers WHERE session_id = $1::uuid ORDER BY role',
      [sessionId],
    );
    return r.rows;
  });
  assert.equal(vues.length, 2);
  // …mais AUCUNE colonne ne porte un profile_id : seulement le rôle.
  assert.deepEqual(Object.keys(vues[0]).sort(), ['answer_index', 'role']);
});

test('ANONYMAT : un tiers ne lit aucune réponse de la session', async () => {
  const rows = await asUser(db, c, async () => {
    const r = await db.query('SELECT 1 FROM aventure_answers WHERE session_id = $1::uuid', [sessionId]);
    return r.rows;
  });
  assert.equal(rows.length, 0);
});

test('FERMÉE AU CLIENT (035) : même un MEMBRE, sous SON PROPRE rôle, ne peut plus écrire', async () => {
  const [low] = ordered(a, b);
  const roleA = low === a ? 'a' : 'b';
  await assert.rejects(
    () => asUser(db, a, () => db.query(
      `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
       VALUES ($1::uuid, 'n2', $2, 0)`, [sessionId, roleA],
    )),
    /row-level security/i,
  );
});

test('un tiers ne peut RIEN écrire dans la session', async () => {
  await assert.rejects(
    () => asUser(db, c, () => db.query(
      `INSERT INTO aventure_answers (session_id, node_id, role, answer_index)
       VALUES ($1::uuid, 'n1', 'a', 0)`, [sessionId],
    )),
    /row-level security/i,
  );
});

// ── « Un seul mystère à la fois », tenu par la base ───────────────────────────

test('UN SEUL mystère actif : une 2ᵉ paire avec un participant déjà pris est refusée', async () => {
  const d = await addUser(db, { firstName: 'Diane' });
  const [low, high] = ordered(a, d); // a est déjà dans une paire active
  await assert.rejects(
    () => db.query(
      `INSERT INTO mystere_pairs (user_low, user_high, state)
       VALUES ($1::uuid, $2::uuid, 'proposed')`, [low, high],
    ),
    /mystère actif/,
  );
});

test('une paire TERMINÉE libère ses participants pour un nouveau mystère', async () => {
  const e = await addUser(db, { firstName: 'Ella' });
  const f = await addUser(db, { firstName: 'Fode' });
  const [low1, high1] = ordered(e, f);
  const pid = (await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'won') RETURNING id`, [low1, high1],
  )).rows[0].id;
  assert.ok(pid);

  // e est libre (sa paire est 'won') → il peut être réapparié.
  const g = await addUser(db, { firstName: 'Gaya' });
  const [low2, high2] = ordered(e, g);
  const pid2 = await db.query(
    `INSERT INTO mystere_pairs (user_low, user_high, state)
     VALUES ($1::uuid, $2::uuid, 'proposed') RETURNING id`, [low2, high2],
  );
  assert.equal(pid2.rows.length, 1);
});

test('une aventure VERROUILLÉE reste unique par paire (pas de double session)', async () => {
  await assert.rejects(
    () => db.query(
      `INSERT INTO aventure_sessions (pair_id, graph_id, current_node)
       VALUES ($1::uuid, 'grotte-ci', 'n1')`, [pairId],
    ),
    /unique|duplicate/i,
  );
});

// ── Cycle de vie : trouver sa paire, démarrer, révéler → match ───────────────

test('on retrouve SA paire non terminale (proposed ou active)', async () => {
  // La query que fera `pairForUser` : l'unique paire non terminale du user.
  const r = await db.query(
    `SELECT id, user_low, user_high, state FROM mystere_pairs
     WHERE state IN ('proposed','active') AND (user_low = $1::uuid OR user_high = $1::uuid)`,
    [a],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, pairId);
});

test('DÉMARRER : la paire passe active, la session existe (déjà le cas ici)', async () => {
  // `before` a créé la paire 'active' + la session : démarrer est idempotent.
  const s = await db.query('SELECT id, current_node FROM aventure_sessions WHERE pair_id = $1::uuid', [pairId]);
  assert.equal(s.rows.length, 1);
  const p = await db.query('SELECT state FROM mystere_pairs WHERE id = $1::uuid', [pairId]);
  assert.equal(p.rows[0].state, 'active');
});

test('RÉVÉLATION : la victoire crée un match entre les deux, et clôt la paire', async () => {
  const [low, high] = ordered(a, b);
  // Ce que fera `revealAndMatch('match')` : créer le match + clore la paire.
  await db.query(
    `INSERT INTO matches (user_low, user_high, last_message_at)
     VALUES ($1::uuid, $2::uuid, now())
     ON CONFLICT (user_low, user_high) DO UPDATE SET is_active = true`,
    [low, high],
  );
  await db.query("UPDATE mystere_pairs SET state = 'won' WHERE id = $1::uuid", [pairId]);

  const m = await db.query(
    'SELECT 1 FROM matches WHERE user_low = $1::uuid AND user_high = $2::uuid',
    [low, high],
  );
  assert.equal(m.rows.length, 1);
  const p = await db.query('SELECT state FROM mystere_pairs WHERE id = $1::uuid', [pairId]);
  assert.equal(p.rows[0].state, 'won');
});

test('une paire close LIBÈRE ses membres pour un futur mystère (plus non terminale)', async () => {
  // Après 'won', la query de pairForUser ne doit plus rien renvoyer pour a.
  const r = await db.query(
    `SELECT 1 FROM mystere_pairs
     WHERE state IN ('proposed','active') AND (user_low = $1::uuid OR user_high = $1::uuid)`,
    [a],
  );
  assert.equal(r.rows.length, 0);
});
