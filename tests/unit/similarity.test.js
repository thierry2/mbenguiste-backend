'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine SIMILARITÉ VISUELLE (cahier §2) — code PUR, zéro I/O.
// cosineSimilarity : mesure entre deux embeddings ; null quand incomputable
// (le ranking mappera null → neutre, invariant maison « à froid → 0.5 »).
// profilePhotoVec : signature visuelle du profil = moyenne pondérée des
// embeddings de ses photos (la photo principale position 0 compte DOUBLE),
// chaque photo normalisée avant moyenne (une photo = une voix), résultat
// re-normalisé (norme 1 → cosinus = simple produit scalaire).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  cosineSimilarity,
  profilePhotoVec,
  toSqlVector,
  fromSqlVector,
} = require('../../src/domain/similarity');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg} (${a} ≠ ${b})`);

// ── cosineSimilarity ─────────────────────────────────────────────────────────

test('cosinus : vecteurs identiques → 1', () => {
  close(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1, 'identiques');
});

test('cosinus : orthogonaux → 0, opposés → -1', () => {
  close(cosineSimilarity([1, 0], [0, 1]), 0, 'orthogonaux');
  close(cosineSimilarity([1, 0], [-1, 0]), -1, 'opposés');
});

test('cosinus : insensible à l\'échelle', () => {
  close(cosineSimilarity([1, 2], [10, 20]), 1, 'même direction, normes différentes');
});

test('cosinus : incomputable → null (dimensions différentes, vide, norme nulle)', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), null);
  assert.equal(cosineSimilarity([], []), null);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), null, 'norme nulle');
  assert.equal(cosineSimilarity(null, [1, 1]), null);
});

// ── profilePhotoVec ──────────────────────────────────────────────────────────

test('photo_vec : une seule photo → son embedding, normé à 1', () => {
  const v = profilePhotoVec([{ position: 0, embedding: [3, 4] }]);
  close(v[0], 0.6, 'x');
  close(v[1], 0.8, 'y');
});

test('photo_vec : la photo principale (position 0) compte DOUBLE', () => {
  // main [1,0] ×2 + secondaire [0,1] ×1 → direction (2,1)/√5.
  const v = profilePhotoVec([
    { position: 0, embedding: [1, 0] },
    { position: 1, embedding: [0, 1] },
  ]);
  close(v[0], 2 / Math.sqrt(5), 'x pondéré');
  close(v[1], 1 / Math.sqrt(5), 'y pondéré');
});

test('photo_vec : chaque photo est normalisée AVANT la moyenne (une photo = une voix)', () => {
  // La secondaire a une norme énorme mais ne doit pas écraser la principale :
  // même résultat qu\'avec [0,1].
  const v = profilePhotoVec([
    { position: 0, embedding: [1, 0] },
    { position: 1, embedding: [0, 1000] },
  ]);
  close(v[0], 2 / Math.sqrt(5), 'x');
  close(v[1], 1 / Math.sqrt(5), 'y');
});

test('photo_vec : ignore les photos sans embedding ; aucune → null', () => {
  const v = profilePhotoVec([
    { position: 0, embedding: null },
    { position: 1, embedding: [0, 2] },
  ]);
  close(v[0], 0, 'x');
  close(v[1], 1, 'y');
  assert.equal(profilePhotoVec([{ position: 0, embedding: null }]), null);
  assert.equal(profilePhotoVec([]), null);
  assert.equal(profilePhotoVec(null), null);
});

test('photo_vec : résultat de norme 1 (cosinus = produit scalaire ensuite)', () => {
  const v = profilePhotoVec([
    { position: 0, embedding: [1, 2, 2] },
    { position: 1, embedding: [4, 0, 3] },
    { position: 2, embedding: [0, 5, 12] },
  ]);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  close(norm, 1, 'norme unité');
});

// ── Sérialisation pgvector ───────────────────────────────────────────────────

test('toSqlVector/fromSqlVector : aller-retour littéral pgvector', () => {
  assert.equal(toSqlVector([1, 0.5, -2]), '[1,0.5,-2]');
  assert.deepEqual(fromSqlVector('[1,0.5,-2]'), [1, 0.5, -2]);
  assert.equal(toSqlVector(null), null);
  assert.equal(fromSqlVector(null), null);
  assert.deepEqual(fromSqlVector(toSqlVector([0.25, 3])), [0.25, 3]);
});
