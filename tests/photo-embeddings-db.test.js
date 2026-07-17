'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB des embeddings photo (migration 021, cahier §2) — PGlite rejoue
// schema.sql avec la VRAIE extension pgvector (halfvec + HNSW, comme Supabase).
//  - profile_photos.embedding halfvec(768), nullable (photo sans empreinte OK,
//    le backfill rattrape) ;
//  - profiles.photo_vec halfvec(768) : signature visuelle du profil ;
//  - l'opérateur cosinus <=> ordonne les profils du plus proche au plus loin
//    (la requête que feront deck / picks / Mystère).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser } = require('./helpers/db');
const { toSqlVector, fromSqlVector } = require('../src/domain/similarity');

const DIM = 768;

/** Vecteur 768d « jouet » : direction donnée sur les 2 premiers axes, zéro ailleurs. */
function vec(x, y) {
  const v = new Array(DIM).fill(0);
  v[0] = x; v[1] = y;
  return v;
}

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

async function addPhoto(profileId, position, embedding = null) {
  const { rows } = await db.query(
    `insert into profile_photos (profile_id, url, position, embedding)
     values ($1::uuid, $2, $3, $4::halfvec) returning id`,
    [profileId, `https://x/p${position}.jpg`, position, embedding && toSqlVector(embedding)],
  );
  return rows[0].id;
}

test('profile_photos.embedding : aller-retour halfvec(768), nullable', async () => {
  const u = await addUser(db);
  const id = await addPhoto(u, 0, vec(3, 4));
  await addPhoto(u, 1, null); // sans empreinte : accepté (backfill plus tard)

  const { rows } = await db.query(
    'select embedding from profile_photos where id = $1::uuid', [id],
  );
  const back = fromSqlVector(rows[0].embedding);
  assert.equal(back.length, DIM);
  // halfvec = float16 : on retrouve les valeurs à la précision près.
  assert.ok(Math.abs(back[0] - 3) < 0.01 && Math.abs(back[1] - 4) < 0.01);

  const { rows: nulls } = await db.query(
    'select count(*)::int as n from profile_photos where profile_id = $1::uuid and embedding is null', [u],
  );
  assert.equal(nulls[0].n, 1);
});

test('profile_photos.embedding : refuse une dimension différente de 768', async () => {
  const u = await addUser(db);
  await assert.rejects(
    db.query(
      `insert into profile_photos (profile_id, url, position, embedding)
       values ($1::uuid, 'https://x/bad.jpg', 9, $2::halfvec)`,
      [u, '[1,2,3]'],
    ),
    /expected 768 dimensions|different halfvec dimensions/i,
  );
});

test('profiles.photo_vec : l\'opérateur <=> ordonne du style le plus proche au plus loin', async () => {
  const viewerTaste = toSqlVector(vec(1, 0));

  const proche = await addUser(db, { firstName: 'Proche' });
  const moyen = await addUser(db, { firstName: 'Moyenne' });
  const loin = await addUser(db, { firstName: 'Lointaine' });
  const sansVec = await addUser(db, { firstName: 'SansVec' }); // photo_vec null → exclue du knn

  const set = (id, v) => db.query(
    'update profiles set photo_vec = $2::halfvec where id = $1::uuid', [id, toSqlVector(v)],
  );
  await set(proche, vec(0.95, 0.05));
  await set(moyen, vec(0.5, 0.5));
  await set(loin, vec(0, 1));

  const { rows } = await db.query(
    `select id, 1 - (photo_vec <=> $1::halfvec) as cos
     from profiles where photo_vec is not null and id = any($2::uuid[])
     order by photo_vec <=> $1::halfvec`,
    [viewerTaste, [proche, moyen, loin, sansVec]],
  );
  assert.deepEqual(rows.map((r) => r.id), [proche, moyen, loin]);
  assert.ok(rows[0].cos > rows[1].cos && rows[1].cos > rows[2].cos, 'cosinus décroissant');
});
