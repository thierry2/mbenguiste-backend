'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// VÉRIFIER QUELLES MIGRATIONS SONT RÉELLEMENT PASSÉES EN BASE.
//
// Ce projet applique ses migrations À LA MAIN (SQL Editor Supabase) : rien ne
// tient le journal de ce qui est passé. Ce script sonde les ARTEFACTS de chaque
// migration récente — la seule vérité qui compte.
//
//   node scripts/check-migrations.js
//
// ⚠ ORDRE DE DÉPLOIEMENT. `SELECT_PROFILE` (profile.model.js) lit désormais
// `terms_accepted_at`, et `findById` sert TOUTE lecture de profil. Déployer ce
// backend AVANT la migration 040 fait échouer chaque lecture — l'app entière
// tombe, pas seulement l'auth. Migrations d'abord, déploiement ensuite.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
  process.exit(1);
}
const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Absente = PostgREST ne trouve ni la fonction ni la colonne. */
const estAbsent = (msg = '') =>
  /could not find the function|does not exist|schema cache/i.test(msg);

async function verifier039() {
  // Lecture pure : renvoie un booléen, n'écrit rien.
  const { error } = await supabase.rpc('email_exists', { p_email: 'sonde@exemple.invalid' });
  return { ok: !error, detail: error?.message };
}

async function verifier040() {
  // On demande la colonne : si elle n'existe pas, PostgREST le dit.
  const { error } = await supabase.from('profiles').select('terms_accepted_at').limit(1);
  return { ok: !error, detail: error?.message };
}

async function verifier042() {
  // `discovery.model` sélectionne ces colonnes à CHAQUE deck : sans elles, la
  // requête des préférences échoue et la découverte tombe. Lecture pure.
  const { error } = await supabase
    .from('match_preferences')
    .select('search_anchor_lat, search_anchor_lng, expand_if_empty')
    .limit(1);
  return { ok: !error, detail: error?.message };
}

async function verifier041() {
  // Sonde INOFFENSIVE : `delete ... where user_id = <uuid nul>` ne correspond à
  // aucun compte (aucun auth.users n'a l'UUID nul) → 0 ligne touchée. On ne
  // teste que l'EXISTENCE de la fonction.
  const { error } = await supabase.rpc('unlink_auth_identities', { p_user_id: NIL_UUID });
  return { ok: !error, detail: error?.message };
}

(async () => {
  const checks = [
    ['039', 'RPC email_exists (check e-mail à l\'inscription)', verifier039],
    ['040', 'colonne profiles.terms_accepted_at (consentement)', verifier040],
    ['041', 'RPC unlink_auth_identities (retour après suppression)', verifier041],
    ['042', 'ancre de recherche + élargissement (match_preferences)', verifier042],
  ];

  console.log(`Base : ${URL}\n`);
  let manquantes = 0;
  for (const [num, quoi, fn] of checks) {
    let res;
    try { res = await fn(); } catch (e) { res = { ok: false, detail: e.message }; }
    if (res.ok) {
      console.log(`  ✅ ${num} — ${quoi}`);
    } else {
      manquantes++;
      const cause = estAbsent(res.detail) ? 'PAS PASSÉE' : `erreur inattendue : ${res.detail}`;
      console.log(`  ❌ ${num} — ${quoi}\n        → ${cause}`);
    }
  }

  console.log('');
  if (manquantes === 0) {
    console.log('✔ Les trois migrations sont en base. Déploiement backend sans risque.');
  } else {
    console.log(`⚠ ${manquantes} migration(s) manquante(s).`);
    console.log('  Passe-les dans le SQL Editor Supabase AVANT de déployer le backend :');
    console.log('  une lecture de profil échouerait sur terms_accepted_at et toute l\'app tomberait.');
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e); process.exit(1); });
