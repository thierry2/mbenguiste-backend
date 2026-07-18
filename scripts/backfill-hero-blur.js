/**
 * Génère la variante HÉROS floutée (blur_hero_url) — masque plein écran de la
 * carte Mystère — pour toutes les photos qui n'en ont pas encore.
 *
 *   node scripts/backfill-hero-blur.js --sigma=<valeur>
 *
 * ⚠ LA CALIBRATION PRÉCÈDE LE BACKFILL. Le sigma héros est un ARBITRAGE visuel
 * (montrer la forme sans le visage), pas un calcul. Le lancer avec un mauvais
 * réglage regénère TOUTES les photos pour rien → il faut recommencer. Donc :
 *
 *   1. node scripts/calibrate-hero-blur.js <url-d-une-photo>
 *   2. Regarder les variantes EN PLEIN ÉCRAN SUR TÉLÉPHONE, choisir un sigma.
 *   3. Reporter ce sigma dans HERO_SIGMA (src/services/mask.service.js).
 *   4. Relancer ici avec --sigma=<la même valeur>.
 *
 * Le garde-fou n'est pas de la cérémonie : il force à énoncer consciemment le
 * sigma retenu, et à ce qu'il corresponde EXACTEMENT à celui gravé dans le code.
 * Sans --sigma, ou s'il diffère de HERO_SIGMA, le script refuse — on ne peut pas
 * regénérer 500 photos par distraction.
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env, `sharp` installé,
 * et la migration 027 appliquée. Idempotent et reprenable : ne touche que les
 * blur_hero_url NULL, donc relançable après une coupure sans refaire le travail.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const { makeHeroMaskedUrl, HERO_SIGMA } = require('../src/services/mask.service');

function parseSigma() {
  const arg = process.argv.find((a) => a.startsWith('--sigma='));
  if (!arg) return null;
  const n = Number(arg.slice('--sigma='.length));
  return Number.isFinite(n) ? n : NaN;
}

(async () => {
  const sigma = parseSigma();
  if (sigma === null) {
    console.error('Refus : passe --sigma=<valeur> = le sigma que tu as calibré à l\'œil.');
    console.error(`Étapes : calibrate-hero-blur.js → choisir → HERO_SIGMA (=${HERO_SIGMA}) → --sigma=${HERO_SIGMA}`);
    process.exit(1);
  }
  if (sigma !== HERO_SIGMA) {
    console.error(`Refus : --sigma=${sigma} ≠ HERO_SIGMA=${HERO_SIGMA} (src/services/mask.service.js).`);
    console.error('Mets d\'abord HERO_SIGMA à la valeur validée, puis relance avec le même --sigma.');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('profile_photos')
    .select('id, url')
    .is('blur_hero_url', null);
  if (error) {
    console.error('Lecture échouée :', error.message);
    process.exit(1);
  }

  console.log(`${data.length} photo(s) à flouter en héros (sigma ${HERO_SIGMA})…`);
  let ok = 0;
  let fail = 0;
  for (const p of data) {
    try {
      const blurHeroUrl = await makeHeroMaskedUrl(p.url);
      const { error: upErr } = await supabase
        .from('profile_photos')
        .update({ blur_hero_url: blurHeroUrl })
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
