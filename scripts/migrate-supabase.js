'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MIGRER LES DONNÉES VERS UN AUTRE PROJET SUPABASE.
//
// Le SCHÉMA est supposé DÉJÀ créé côté destination (db/schema.sql). Ce script ne
// s'occupe QUE des données de `public.*` : il parcourt les tables dans l'ordre
// des clés étrangères, lit la source par pages, et upsert dans la destination.
//
//   node scripts/migrate-supabase.js --dest-url=https://xxx.supabase.co --dest-key=<service_role>
//
//   --dry-run      compte et affiche, n'écrit RIEN (à lancer en premier)
//   --only=a,b     ne traite que ces tables
//   --skip=a,b     saute ces tables
//   --reset-ref    VIDE les tables de référence de la destination avant copie
//                  (voir « LE PIÈGE DES UUID » ci-dessous — souvent obligatoire)
//   --page=1000    taille de page en lecture
//
// La SOURCE vient du .env habituel (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
//
// ─────────────────────────────────────────────────────────────────────────────
// CE QUE CE SCRIPT NE FAIT PAS, ET QUI COMPTE PLUS QUE CE QU'IL FAIT
//
// 1. IL NE MIGRE PAS `auth.users`. Or `profiles.id` est une clé étrangère vers
//    `auth.users(id)` : sans les comptes, AUCUN profil ne s'insère, et tout le
//    reste tombe en cascade. Le script le VÉRIFIE avant d'écrire et s'arrête en
//    disant lesquels manquent. Les mots de passe ne se recopient pas par l'API —
//    seul un pg_dump des tables `auth` les préserve.
//
// 2. IL NE MIGRE PAS LE STORAGE. Quatre buckets (`photos` et `aventure` PUBLICS,
//    `chat-media` et `verification-selfies` PRIVÉS). Les fichiers doivent être
//    copiés à part, et les URL stockées en base RÉÉCRITES : elles contiennent
//    l'identifiant de l'ancien projet dans leur nom d'hôte.
//
// 3. LE PIÈGE DES UUID DE RÉFÉRENCE. Les tables de référence (genders,
//    interests, prompts…) sont SEEDÉES par schema.sql avec des
//    `gen_random_uuid()` — donc des identifiants DIFFÉRENTS de la source. Si on
//    se contente d'y ajouter les lignes source, la contrainte d'unicité sur
//    `code` explose ; et si on ne fait rien, `profiles.gender_id` pointe dans le
//    vide. `--reset-ref` vide ces tables côté destination pour les recopier
//    À L'IDENTIQUE. C'est presque toujours ce qu'il faut faire.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { REFERENCE, TABLES } = require('./lib/migration-plan');

// ── L'ORDRE DES CLÉS ÉTRANGÈRES ─────────────────────────────────────────────
// Un parent avant ses enfants, toujours. `conflict` = la cible de l'upsert (la
// clé primaire), ce qui rend le script REJOUABLE sans rien dupliquer.


// ── Arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const has = (n) => args.includes(`--${n}`);

const SRC_URL = process.env.SUPABASE_URL;
const SRC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = flag('dest-url') || process.env.DEST_SUPABASE_URL;
const DST_KEY = flag('dest-key') || process.env.DEST_SUPABASE_SERVICE_ROLE_KEY;
const DRY = has('dry-run');
const RESET_REF = has('reset-ref');
const PAGE = Number(flag('page', '1000')) || 1000;
const ONLY = (flag('only') || '').split(',').filter(Boolean);
const SKIP = (flag('skip') || '').split(',').filter(Boolean);

function mourir(msg) { console.error(`❌ ${msg}`); process.exit(1); }

if (!SRC_URL || !SRC_KEY || /your-service|placeholder/i.test(SRC_KEY)) {
  mourir('SOURCE : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (ou placeholder) dans .env');
}
if (!DST_URL || !DST_KEY) {
  mourir('DESTINATION : --dest-url=… --dest-key=… requis (ou DEST_SUPABASE_URL / DEST_SUPABASE_SERVICE_ROLE_KEY)');
}
if (SRC_URL === DST_URL) mourir('source et destination IDENTIQUES — refus (ce serait écrire sur soi-même)');

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const src = createClient(SRC_URL, SRC_KEY, opts);
const dst = createClient(DST_URL, DST_KEY, opts);

/** Lit une table entière, page par page (PostgREST plafonne les réponses). */
async function lireTout(client, table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * GARDE-FOU : tout profil source doit avoir SON compte dans l'auth de la
 * destination, avec le MÊME uuid. Sans ça l'insertion échouerait de toute façon
 * — autant le dire AVANT d'avoir à moitié copié la base.
 */
async function verifierAuth(profils) {
  const ids = new Set();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await dst.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth destination : ${error.message}`);
    (data.users || []).forEach((u) => ids.add(u.id));
    if (!data.users || data.users.length < 1000) break;
  }
  const manquants = profils.filter((p) => !ids.has(p.id));
  console.log(`\n🔑 Comptes auth destination : ${ids.size} · profils source : ${profils.length}`);
  if (manquants.length) {
    console.error(`❌ ${manquants.length} profil(s) sans compte auth dans la destination.`);
    console.error('   Les 5 premiers :', manquants.slice(0, 5).map((p) => `${p.email || '?'} (${p.id})`).join(', '));
    console.error('\n   `profiles.id` référence `auth.users(id)` : rien ne s’insérera tant que');
    console.error('   ces comptes n’existent pas AVEC LE MÊME uuid. Les mots de passe ne se');
    console.error('   recopient pas par l’API — il faut un pg_dump des tables `auth`.');
    return false;
  }
  console.log('✅ Tous les profils source ont leur compte auth dans la destination.');
  return true;
}

(async () => {
  console.log(`SOURCE      ${SRC_URL}`);
  console.log(`DESTINATION ${DST_URL}`);
  if (DRY) console.log('🧪 DRY-RUN : lecture seule, aucune écriture.\n');

  const aFaire = TABLES.filter(({ t }) =>
    (!ONLY.length || ONLY.includes(t)) && !SKIP.includes(t));

  // ── Contrôle auth AVANT toute écriture ────────────────────────────────────
  if (aFaire.some((x) => x.t === 'profiles')) {
    const profils = await lireTout(src, 'profiles');
    const ok = await verifierAuth(profils);
    if (!ok && !DRY) mourir('migration interrompue AVANT toute écriture.');
  }

  const bilan = [];
  for (const { t, conflict } of aFaire) {
    let lignes;
    try { lignes = await lireTout(src, t); } catch (e) {
      console.log(`⏭  ${t.padEnd(24)} lecture impossible (${e.message}) — sautée`);
      bilan.push({ t, lus: 0, ecrits: 0, note: 'lecture KO' });
      continue;
    }
    if (!lignes.length) {
      console.log(`·  ${t.padEnd(24)} vide`);
      bilan.push({ t, lus: 0, ecrits: 0 });
      continue;
    }

    if (DRY) {
      console.log(`🧪 ${t.padEnd(24)} ${String(lignes.length).padStart(6)} ligne(s) à copier`);
      bilan.push({ t, lus: lignes.length, ecrits: 0 });
      continue;
    }

    // Les tables de référence sont déjà seedées côté destination AVEC D'AUTRES
    // UUID : on les vide pour recopier à l'identique, sinon `code` duplique et
    // les clés étrangères des profils pointent dans le vide.
    if (RESET_REF && REFERENCE.has(t)) {
      const { error } = await dst.from(t).delete().neq('code', ' ');
      if (error) console.warn(`   ⚠ purge ${t} : ${error.message}`);
    }

    let ecrits = 0;
    for (let i = 0; i < lignes.length; i += PAGE) {
      const lot = lignes.slice(i, i + PAGE);
      const { error } = await dst.from(t).upsert(lot, { onConflict: conflict });
      if (error) {
        console.error(`❌ ${t} (lot ${i}-${i + lot.length}) : ${error.message}`);
        bilan.push({ t, lus: lignes.length, ecrits, note: 'ÉCHEC' });
        break;
      }
      ecrits += lot.length;
    }
    console.log(`✅ ${t.padEnd(24)} ${String(ecrits).padStart(6)} / ${lignes.length}`);
    if (!bilan.find((b) => b.t === t)) bilan.push({ t, lus: lignes.length, ecrits });
  }

  const echecs = bilan.filter((b) => b.note === 'ÉCHEC');
  console.log(`\n── Bilan : ${bilan.reduce((n, b) => n + b.ecrits, 0)} ligne(s) écrite(s), `
    + `${echecs.length} table(s) en échec`);
  if (echecs.length) console.log('   ', echecs.map((b) => b.t).join(', '));
  console.log('\n⚠ RESTE À FAIRE À LA MAIN :');
  console.log('   · le Storage (4 buckets) et la RÉÉCRITURE des URL en base ;');
  console.log('   · vérifier la publication Realtime (4 tables) ;');
  console.log('   · les variables d’environnement du backend et de l’app.');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
