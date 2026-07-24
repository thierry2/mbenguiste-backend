'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RATTRAPAGE — neutraliser les comptes auth DÉJÀ purgés avant le correctif.
//
// Avant le fix de purgeAccount, la purge anonymisait `profiles` mais laissait le
// compte `auth.users` réutilisable et JOIGNABLE :
//   • e-mail toujours capté (impossible de revenir en e-mail/mot de passe) ;
//   • identités OAuth (Google) toujours collées → une reconnexion Google retombe
//     sur le compte et échoue (bounce silencieux vers l'accueil) ;
//   • session encore ouvrable dans le vide (403 partout).
//
// Ce script rejoue la neutralisation manquante pour ces comptes-là — les TROIS
// gestes de purgeAccount, chacun idempotent :
//   1. détache les identités OAuth (RPC unlink_auth_identities, migr 041) ;
//   2. brouille l'e-mail (tombstone @deleted.invalid) s'il ne l'est pas déjà ;
//   3. bannit le compte.
//
// ⚠ Ne se contente PAS de sauter un compte déjà brouillé : l'étape 1 (identités)
// a pu manquer sur un compte que le premier backfill avait seulement brouillé.
//
//   node scripts/backfill-purged-auth.js --dry-run   # affiche l'état, n'écrit rien
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

  console.log(`${purged.length} compte(s) purgé(s) trouvé(s).${DRY_RUN ? '  (dry-run — aucune écriture)' : ''}\n`);

  let traites = 0;
  let echecs = 0;

  for (const { id } of purged) {
    // ── DIAGNOSTIC : état actuel du compte auth ─────────────────────────────
    const { data: got, error: getErr } = await supabase.auth.admin.getUserById(id);
    if (getErr || !got?.user) {
      console.log(`  • ${id} — compte auth absent (déjà supprimé ?), rien à faire`);
      continue;
    }
    const u = got.user;
    const emailScramble = (u.email || '').endsWith('@deleted.invalid');
    const identites = (u.identities || []).map((i) => i.provider);
    const banni = !!u.banned_until && new Date(u.banned_until) > new Date();
    console.log(
      `  • ${id}\n`
      + `      e-mail     : ${u.email || '(vide)'}${emailScramble ? '  [brouillé ✓]' : '  [À BROUILLER]'}\n`
      + `      identités  : ${identites.length ? identites.join(', ') + '  [À DÉTACHER]' : '(aucune)  [ok]'}\n`
      + `      banni      : ${banni ? 'oui ✓' : 'NON'}`,
    );

    if (DRY_RUN) { traites++; continue; }

    try {
      // 1. Détacher les identités OAuth (idempotent : 0 ligne si déjà détaché).
      if (identites.length) {
        const { error: idErr } = await supabase.rpc('unlink_auth_identities', { p_user_id: id });
        if (idErr) throw idErr;
      }
      // 2. + 3. Brouiller l'e-mail (si pas déjà) + bannir. On repasse toujours le
      //    ban : un compte brouillé par le 1er backfill n'était pas forcément banni.
      const patch = { ban_duration: '876000h' };
      if (!emailScramble) { patch.email = `deleted-${id}@deleted.invalid`; patch.email_confirm = true; }
      const { error: updErr } = await supabase.auth.admin.updateUserById(id, patch);
      if (updErr) throw updErr;
      console.log('      → neutralisé ✓');
      traites++;
    } catch (e) {
      console.error(`      ⚠ échec : ${e.message}`);
      echecs++;
    }
  }

  console.log(`\n✔ ${traites} traité(s), ${echecs} échec(s).`);
  if (DRY_RUN) console.log('   (dry-run : relance sans --dry-run pour appliquer)');
}

main().catch((e) => { console.error(e); process.exit(1); });
