'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// embedding.service — empreintes visuelles des photos (cahier §2, décision
// 17/07 : génération 100 % LOCALE, SigLIP 2 base via @huggingface/transformers,
// pas de reconnaissance faciale). Best-effort à l'upload (une empreinte ratée
// ne bloque jamais la photo — le backfill rattrape).
//
// Factory à dépendances injectées + instance par défaut câblée (pattern maison).
// ─────────────────────────────────────────────────────────────────────────────
const { profilePhotoVec, toSqlVector } = require('../domain/similarity');

// Dimension du modèle (SigLIP 2 base = 768) — doit correspondre au halfvec(768)
// de la migration 021 : un vecteur d'une autre taille est REFUSÉ (fail fast,
// jamais de base polluée par un mauvais modèle).
const EMBEDDING_DIM = 768;

function createEmbeddingService({ generator, photos, profiles, dim = EMBEDDING_DIM }) {
  /** Empreinte d'une image (Buffer) via le générateur local. */
  async function embedImage(buffer) {
    const vec = await generator.embed(buffer);
    if (!Array.isArray(vec) || vec.length !== dim) {
      throw new Error(
        `Embedding de dimension inattendue (${vec?.length ?? 'aucune'} ≠ ${dim}) — modèle mal configuré ?`,
      );
    }
    return vec;
  }

  /**
   * Recalcule la signature visuelle du profil (moyenne pondérée de ses photos,
   * la principale double) et l'écrit — null si plus aucune empreinte (une
   * signature périmée mentirait au ranking).
   */
  async function refreshProfileVec(profileId) {
    const rows = await photos.embeddingsOf(profileId);
    const vec = profilePhotoVec(rows);
    await profiles.setPhotoVec(profileId, toSqlVector(vec));
    return vec;
  }

  return { embedImage, refreshProfileVec };
}

// ── Instance par défaut (générateur réel lazy — le modèle ne se charge qu'au
//    premier embedding, jamais au boot du serveur) ─────────────────────────────
const defaultGenerator = require('./embedding.generator');
const defaultPhotos = require('../models/photo.model');
const defaultProfiles = require('../models/profile.model');

const defaultService = createEmbeddingService({
  generator: defaultGenerator,
  photos: defaultPhotos,
  profiles: defaultProfiles,
});

module.exports = {
  EMBEDDING_DIM,
  createEmbeddingService,
  embedImage: defaultService.embedImage,
  refreshProfileVec: defaultService.refreshProfileVec,
};
