'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// embedding.service (cahier §2) — factory DI, générateur FAKE (le vrai SigLIP
// local est sondé à part, pas dans la suite). Contrats :
//  - embedImage : délègue au générateur, refuse une dimension inattendue
//    (fail fast : un mauvais modèle ne doit JAMAIS polluer la base) ;
//  - refreshProfileVec : photos → signature pondérée (domaine) → écrite au
//    profil ; null quand plus aucune empreinte (une signature périmée ment).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmbeddingService } = require('../../src/services/embedding.service');
const { fromSqlVector } = require('../../src/domain/similarity');

const DIM = 4; // dimension réduite pour les tests (réglée via l'option dim)

function fakes({ photos = [], embed } = {}) {
  const calls = { setPhotoVec: [], embed: [] };
  return {
    calls,
    generator: {
      embed: async (buffer) => {
        calls.embed.push(buffer);
        return embed ? embed(buffer) : [1, 0, 0, 0];
      },
    },
    photosModel: { embeddingsOf: async () => photos },
    profilesModel: {
      setPhotoVec: async (profileId, vec) => { calls.setPhotoVec.push([profileId, vec]); },
    },
  };
}

function service(f, opts = {}) {
  return createEmbeddingService({
    generator: f.generator,
    photos: f.photosModel,
    profiles: f.profilesModel,
    dim: DIM,
    ...opts,
  });
}

test('embedImage : délègue au générateur et renvoie le vecteur', async () => {
  const f = fakes();
  const buf = Buffer.from('fake-image');
  const v = await service(f).embedImage(buf);
  assert.deepEqual(v, [1, 0, 0, 0]);
  assert.equal(f.calls.embed[0], buf);
});

test('embedImage : dimension inattendue → rejet (rien ne part en base)', async () => {
  const f = fakes({ embed: () => [1, 2] }); // 2 ≠ dim 4
  await assert.rejects(service(f).embedImage(Buffer.from('x')), /dimension/i);
});

test('refreshProfileVec : signature pondérée écrite au profil (littéral pgvector, norme 1)', async () => {
  const f = fakes({
    photos: [
      { position: 0, embedding: [1, 0, 0, 0] },  // principale ×2
      { position: 1, embedding: [0, 1, 0, 0] },
    ],
  });
  const out = await service(f).refreshProfileVec('user-1');

  assert.equal(f.calls.setPhotoVec.length, 1);
  const [profileId, literal] = f.calls.setPhotoVec[0];
  assert.equal(profileId, 'user-1');
  const stored = fromSqlVector(literal);
  const s5 = Math.sqrt(5);
  assert.ok(Math.abs(stored[0] - 2 / s5) < 1e-9 && Math.abs(stored[1] - 1 / s5) < 1e-9);
  assert.deepEqual(out, stored);
});

test('refreshProfileVec : plus aucune empreinte → photo_vec remis à null', async () => {
  const f = fakes({ photos: [{ position: 0, embedding: null }] });
  const out = await service(f).refreshProfileVec('user-2');
  assert.deepEqual(f.calls.setPhotoVec, [['user-2', null]]);
  assert.equal(out, null);
});
