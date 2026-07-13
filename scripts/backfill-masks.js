/**
 * Génère la version floutée (blur_url) de toutes les photos qui n'en ont pas encore.
 * À lancer une fois après la migration 011 (et sur les comptes de seed existants).
 *
 *   node scripts/backfill-masks.js
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env, `sharp` installé,
 * et la migration 011 appliquée. Idempotent : ne retouche que les blur_url NULL.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const { makeMaskedUrl } = require('../src/services/mask.service');

(async () => {
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id, url')
    .is('blur_url', null);
  if (error) {
    console.error('Lecture échouée :', error.message);
    process.exit(1);
  }

  console.log(`${data.length} photo(s) à flouter…`);
  let ok = 0;
  let fail = 0;
  for (const p of data) {
    try {
      const blurUrl = await makeMaskedUrl(p.url);
      const { error: upErr } = await supabase
        .from('profile_photos')
        .update({ blur_url: blurUrl })
        .eq('id', p.id);
      if (upErr) throw upErr;
      ok++;
      console.log(`  ✓ ${p.id}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${p.id} — ${e.message}`);
    }
  }
  console.log(`Terminé : ${ok} ok, ${fail} échec(s).`);
  process.exit(fail ? 1 : 0);
})();
