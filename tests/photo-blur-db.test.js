'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB des masques flous (migrations 011 + 027) — PGlite rejoue schema.sql.
// Ce test existe parce que schema.sql avait DÉRIVÉ : les colonnes blur_url /
// blur_hero_url vivaient dans les migrations mais pas dans le schéma de test, si
// bien qu'aucun test ne pouvait les toucher. Il verrouille les deux :
//   • blur_url       — masque tuile (grille « qui t'a liké ») ;
//   • blur_hero_url  — masque plein écran (carte Mystère, migration 027).
// Les deux nullables : best-effort à l'upload, le backfill rattrape.
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

test('profile_photos : blur_url et blur_hero_url existent, nullables, aller-retour', async () => {
  const u = await addUser(db);

  // Photo AVEC les deux masques.
  const { rows: withBlur } = await db.query(
    `insert into profile_photos (profile_id, url, position, blur_url, blur_hero_url)
     values ($1::uuid, 'https://x/net.jpg', 0, 'https://x/tuile.jpg', 'https://x/hero.jpg')
     returning blur_url, blur_hero_url`,
    [u],
  );
  assert.equal(withBlur[0].blur_url, 'https://x/tuile.jpg');
  assert.equal(withBlur[0].blur_hero_url, 'https://x/hero.jpg');

  // Photo SANS masque héros (état avant backfill 027) : accepté.
  const { rows: pending } = await db.query(
    `insert into profile_photos (profile_id, url, position, blur_url)
     values ($1::uuid, 'https://x/net2.jpg', 1, 'https://x/tuile2.jpg')
     returning blur_url, blur_hero_url`,
    [u],
  );
  assert.equal(pending[0].blur_url, 'https://x/tuile2.jpg');
  assert.equal(pending[0].blur_hero_url, null);
});

test('blur_hero_url null = la cible du backfill (migration 027)', async () => {
  const u = await addUser(db, { firstName: 'Backfill' });
  await db.query(
    `insert into profile_photos (profile_id, url, position, blur_url)
     values ($1::uuid, 'https://x/a.jpg', 0, 'https://x/a-tuile.jpg')`,
    [u],
  );

  // Ce que lit backfill-hero-blur.js : les photos dont le masque héros manque.
  const { rows } = await db.query(
    `select count(*)::int as n from profile_photos
     where profile_id = $1::uuid and blur_hero_url is null`,
    [u],
  );
  assert.equal(rows[0].n, 1);
});
