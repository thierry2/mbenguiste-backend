'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RATTRAPAGE — neutraliser les comptes auth DÉJÀ purgés avant le correctif.
//
// Avant le fix de purgeAccount (juillet), la purge anonymisait `profiles` mais
// laissait `auth.users` INTACT : l'e-mail restait capté à vie (impossible de
// revenir) et une session pouvait encore s'ouvrir dans le vide (403 partout).
//
// Ce script rejoue la neutralisation manquante pour ces comptes-là : pour chaque
// `profiles` déjà supprimé (deleted_at non nul), il remplace l'e-mail auth par
// une adresse-tombstone jetable et bannit le compte — exactement ce que fait
// désormais purgeAccount. Idempotent : un compte déjà tombstoné (@deleted.invalid)
// est ignoré.
//
//   node scripts/backfill-purged-auth.js --dry-run   # compte et affiche, n'écrit rien
//   node scripts/backfill-purged-auth.js             # applique
//
// Lit SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans le .env habituel.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  // Tous les profils déjà purgés (tombstone applicatif posé).
  const { data: purged, error } = await supabase
    .from('profiles')
    .select('id')
    .not('deleted_at', 'is', null);
  if (error) throw error;

  console.log(`${purged.length} compte(s) purgé(s) trouvé(s).${DRY_RUN ? ' (dry-run)' : ''}`);

  let neutralises = 0;
  let dejaFaits = 0;
  let echecs = 0;

  for (const { id } of purged) {
    // État actuel du compte auth : si l'e-mail est déjà une tombstone, rien à faire.
    const { data: got, error: getErr } = await supabase.auth.admin.getUserById(id);
    if (getErr || !got?.user) {
      // Compte auth déjà absent (supprimé à la main ?) → rien à neutraliser.
      dejaFaits++;
      continue;
    }
    const email = got.user.email || '';
    if (email.endsWith('@deleted.invalid')) { dejaFaits++; continue; }

    console.log(`  • ${id} — e-mail « ${email} » → tombstone`);
    if (DRY_RUN) { neutralises++; continue; }

    const { error: updErr } = await supabase.auth.admin.updateUserById(id, {
      email: `deleted-${id}@deleted.invalid`,
      email_confirm: true,
      ban_duration: '876000h',
    });
    if (updErr) { console.error(`    ⚠ échec : ${updErr.message}`); echecs++; continue; }
    neutralises++;
  }

  console.log(`\n✔ ${neutralises} neutralisé(s), ${dejaFaits} déjà fait(s), ${echecs} échec(s).`);
  if (DRY_RUN) console.log('   (dry-run : aucune écriture réelle)');
}

main().catch((e) => { console.error(e); process.exit(1); });
