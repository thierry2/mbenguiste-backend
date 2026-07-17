'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Base Postgres EN MÉMOIRE (PGlite) — le VRAI db/schema.sql exécuté verbatim
// (trigger mutual-like → match, trigger last_message_at, RLS). Aucune connexion
// à Supabase : tout vit et meurt dans le process de test. (Pattern AfrikMoms.)
//
// Adaptations documentées, les seules :
//  - postgis n'existe pas dans PGlite → `geography(Point, 4326)` devient text
//    (la colonne current_geo n'est jamais interrogée par les tests) ;
//  - le schéma `auth` de Supabase est rejoué : table auth.users + auth.uid()
//    factice qui lit le réglage de session `test.uid` → les policies RLS sont
//    TESTABLES pour de vrai via `asUser()` (SET ROLE authenticated) ;
//  - pgcrypto retiré (gen_random_uuid() est natif dans ce Postgres).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
// pgvector (halfvec + HNSW) : la VRAIE extension, embarquée pour PGlite —
// schema.sql exécute `create extension if not exists vector;` verbatim.
const { vector } = require('@electric-sql/pglite-pgvector');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'db', 'schema.sql');

// Rejoue le socle Supabase dont schema.sql dépend.
const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
-- auth.uid() de Supabase : ici il lit le réglage de session posé par asUser().
create or replace function auth.uid() returns uuid language sql stable as
  $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
do $do$ begin create role authenticated; exception when duplicate_object then null; end $do$;
do $do$ begin create role anon; exception when duplicate_object then null; end $do$;
`;

// Droits du rôle applicatif (Supabase les accorde d'office) — sans eux, RLS ou
// pas, `authenticated` ne verrait rien du tout et les tests ne testeraient rien.
const GRANTS = `
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
`;

/** Base neuve : socle auth factice + schema.sql verbatim (adapté, cf. en-tête). */
async function createDb() {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(SUPABASE_STUBS);
  const schema = fs
    .readFileSync(SCHEMA_PATH, 'utf8')
    .replace(/create extension if not exists "(pgcrypto|postgis)";?/g, '')
    .replace(/geography\(Point, 4326\)/g, 'text');
  await db.exec(schema);
  await db.exec(GRANTS);
  return db;
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function addUser(db, { firstName = 'Awa', birthDate = '1995-06-15' } = {}) {
  const id = randomUUID();
  await db.query('INSERT INTO auth.users (id) VALUES ($1::uuid)', [id]);
  await db.query(
    `INSERT INTO profiles (id, first_name, birth_date, onboarding_done)
     VALUES ($1::uuid, $2, $3::date, true)`,
    [id, firstName, birthDate],
  );
  return id;
}

/** Swipe via SQL — exactement ce que fait le backend (le trigger fait le reste). */
async function swipe(db, swiperId, targetId, action = 'like') {
  await db.query(
    `INSERT INTO swipes (swiper_id, target_id, action_id)
     VALUES ($1::uuid, $2::uuid, (SELECT id FROM swipe_actions WHERE code = $3))`,
    [swiperId, targetId, action],
  );
}

/** Les matchs entre a et b (0 ou 1 si la contrainte unique fait son travail). */
async function matchesBetween(db, a, b) {
  const [low, high] = a < b ? [a, b] : [b, a];
  const res = await db.query(
    'SELECT * FROM matches WHERE user_low = $1::uuid AND user_high = $2::uuid',
    [low, high],
  );
  return res.rows;
}

async function sendMessage(db, matchId, senderId, body = 'Coucou !') {
  const res = await db.query(
    `INSERT INTO messages (match_id, sender_id, body)
     VALUES ($1::uuid, $2::uuid, $3) RETURNING id, created_at`,
    [matchId, senderId, body],
  );
  return res.rows[0];
}

// ── RLS : exécuter une fonction « en tant que » tel utilisateur connecté ─────
// SET ROLE authenticated (non-propriétaire → RLS s'applique) + test.uid pour
// que auth.uid() renvoie l'utilisateur voulu. Reset garanti en sortie.

async function asUser(db, uid, fn) {
  await db.query("select set_config('test.uid', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('test.uid', '', false)", []);
  }
}

module.exports = { createDb, addUser, swipe, matchesBetween, sendMessage, asUser };
