'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine SIMILARITÉ VISUELLE — code PUR (zéro I/O), cahier §2.
// Empreintes photo (SigLIP 2 local, 768 dims) comparées par cosinus.
//  - cosineSimilarity → null quand incomputable ; le ranking mappe null → neutre
//    (invariant maison : agrégats vides → 0.5, jamais un faux signal).
//  - profilePhotoVec : signature visuelle du profil = moyenne pondérée des
//    embeddings de ses photos. Chaque photo est NORMALISÉE avant la moyenne
//    (une photo = une voix, sa norme brute ne vote pas) ; la photo principale
//    (position 0) compte double ; résultat re-normalisé (norme 1 → le cosinus
//    devient un simple produit scalaire côté SQL comme côté JS).
// ─────────────────────────────────────────────────────────────────────────────

const MAIN_PHOTO_WEIGHT = 2; // la photo principale pèse double dans la signature

function norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i] * v[i];
  return Math.sqrt(s);
}

/** Cosinus entre deux vecteurs, ou null si incomputable (vide, dims ≠, norme 0). */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (!a.length || a.length !== b.length) return null;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return null;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot / (na * nb);
}

/**
 * Signature visuelle d'un profil à partir de ses photos [{ position, embedding }].
 * Ignore les photos sans embedding. Renvoie un vecteur de norme 1, ou null si
 * aucune empreinte exploitable.
 */
function profilePhotoVec(photos) {
  const usable = (photos || []).filter(
    (p) => Array.isArray(p?.embedding) && p.embedding.length && norm(p.embedding) > 0,
  );
  if (!usable.length) return null;

  const dim = usable[0].embedding.length;
  const acc = new Array(dim).fill(0);
  for (const p of usable) {
    if (p.embedding.length !== dim) continue; // dimension étrangère : ne vote pas
    const w = p.position === 0 ? MAIN_PHOTO_WEIGHT : 1;
    const n = norm(p.embedding);
    for (let i = 0; i < dim; i += 1) acc[i] += (w * p.embedding[i]) / n;
  }
  const total = norm(acc);
  if (total === 0) return null; // photos qui s'annulent exactement : pas de signature
  return acc.map((x) => x / total);
}

/** Tableau JS → littéral pgvector '[x,y,…]' (accepté par vector/halfvec). */
function toSqlVector(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return `[${arr.join(',')}]`;
}

/** Littéral pgvector (string) → tableau JS. */
function fromSqlVector(text) {
  if (typeof text !== 'string' || !text.length) return null;
  return JSON.parse(text);
}

module.exports = { cosineSimilarity, profilePhotoVec, toSqlVector, fromSqlVector };
