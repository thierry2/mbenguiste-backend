/**
 * Génère l'empreinte visuelle (embedding SigLIP 2 LOCAL, cahier §2) de toutes
 * les photos qui n'en ont pas encore, puis recalcule la signature photo_vec des
 * profils touchés. À lancer une fois après la migration 021 (puis au besoin :
 * il rattrape aussi les uploads dont l'embedding best-effort a échoué).
 *
 *   node scripts/backfill-embeddings.js
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env et la migration
 * 021 appliquée. 1er lancement : télécharge le modèle (~100 Mo, mis en cache).
 * Idempotent : ne traite que les embedding NULL, reprend où il s'est arrêté
 * (batches), un échec ne bloque pas les suivants.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const generator = require('../src/services/embedding.generator');
const { refreshProfileVec } = require('../src/services/embedding.service');
const { toSqlVector } = require('../src/domain/similarity');

const BATCH = 100; // photos par lecture — l'embedding lui-même est séquentiel (CPU-bound)

async function fetchBatch() {
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id, profile_id, url')
    .is('embedding', null)
    .order('id', { ascending: true })
    .limit(BATCH);
  if (error) throw error;
  return data || [];
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  console.log(`Modèle : ${generator.MODEL}`);
  let ok = 0;
  let fail = 0;
  const failed = new Set();     // pour ne pas relire en boucle les mêmes échecs
  const profils = new Set();    // profils touchés → photo_vec à recalculer

  for (;;) {
    const batch = (await fetchBatch()).filter((p) => !failed.has(p.id));
    if (!batch.length) break;

    for (const p of batch) {
      try {
        const vec = toSqlVector(await generator.embed(await download(p.url)));
        const { error } = await supabase
          .from('profile_photos')
          .update({ embedding: vec })
          .eq('id', p.id);
        if (error) throw error;
        profils.add(p.profile_id);
        ok++;
        if (ok % 25 === 0) console.log(`  … ${ok} photos empreintées`);
      } catch (e) {
        failed.add(p.id);
        fail++;
        console.error(`  ✗ photo ${p.id} — ${e.message}`);
      }
    }
  }

  console.log(`${ok} embedding(s) générés, ${fail} échec(s). Signatures de ${profils.size} profil(s)…`);
  let vecFail = 0;
  for (const id of profils) {
    try {
      await refreshProfileVec(id);
    } catch (e) {
      vecFail++;
      console.error(`  ✗ photo_vec ${id} — ${e.message}`);
    }
  }
  console.log(`Terminé : ${ok} photos, ${profils.size - vecFail} signature(s) de profil, ${fail + vecFail} échec(s).`);
  process.exit(fail + vecFail ? 1 : 0);
})();
