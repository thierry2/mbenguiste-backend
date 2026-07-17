'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Générateur d'embeddings visuels — 100 % LOCAL (décision 17/07, cahier §2).
// SigLIP 2 base (Google) en ONNX quantisé via @huggingface/transformers :
// ~0 €/photo, aucun appel externe, ~100 ms CPU. PAS de reconnaissance faciale —
// l'empreinte capte le style/la scène, jamais l'identité (RGPD, cahier §8).
//
// Lazy : le modèle (~100 Mo, mis en cache disque par transformers.js) ne se
// charge qu'au PREMIER embedding — le boot du serveur reste instantané.
// transformers.js est ESM-only → import() dynamique depuis ce module CommonJS.
// ─────────────────────────────────────────────────────────────────────────────
const sharp = require('sharp');

const MODEL = process.env.EMBEDDING_MODEL || 'onnx-community/siglip2-base-patch16-224-ONNX';
const DTYPE = process.env.EMBEDDING_DTYPE || 'q8'; // quantisé 8 bits : 4× plus léger, qualité quasi intacte

let loading = null;
function load() {
  if (!loading) {
    loading = (async () => {
      const { pipeline, RawImage } = await import('@huggingface/transformers');
      const extractor = await pipeline('image-feature-extraction', MODEL, { dtype: DTYPE });
      return { extractor, RawImage };
    })();
    // Un échec de chargement ne doit pas rester gravé : on retentera au prochain appel.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * Empreinte d'une image (Buffer jpeg/png/webp) → vecteur L2-normalisé.
 * Décodage par sharp (déjà en place pour le flou) : le pipeline reçoit des
 * pixels bruts, pas un fichier — mêmes entrées à l'upload et au backfill.
 */
async function embed(buffer) {
  const { extractor, RawImage } = await load();
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);

  // `pool: true` : la tête de pooling du modèle → UN vecteur [1, 768] par image.
  // Sans lui, le pipeline renvoie les 196 embeddings de patches ([1, 196, 768]),
  // inutilisables tels quels (sonde du 17/07 : 150 528 valeurs).
  const output = await extractor(image, { pool: true });
  const raw = Array.from(output.data);

  const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0));
  if (!norm) throw new Error('Embedding nul — image indéchiffrable ?');
  return raw.map((x) => x / norm);
}

module.exports = { embed, MODEL };
