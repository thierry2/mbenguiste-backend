'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION COMPLÈTE VERS UN AUTRE PROJET SUPABASE — comptes, données, fichiers.
//
// Le SCHÉMA est supposé DÉJÀ créé côté destination (`db/schema.sql`).
//
//   node scripts/migrate-all.js --dest-url=https://xxx.supabase.co \
//                               --dest-key=<service_role> \
//                               --password=<mot de passe des comptes recréés>
//
//   --dry-run     compte et affiche, n'écrit RIEN — À LANCER EN PREMIER
//   --skip-auth   ne recrée pas les comptes (ils existent déjà)
//   --skip-data   ne copie pas les tables
//   --skip-files  ne copie pas le Storage
//   --reset-ref   vide les tables de référence avant copie (voir plan)
//   --page=1000   taille de page en lecture
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ LES MOTS DE PASSE NE SE MIGRENT PAS PAR L'API.
//
// `listUsers` ne rend AUCUN hachage : c'est voulu, et c'est une bonne chose.
// Ce script recrée donc les comptes avec le MÊME uuid et le MÊME e-mail, mais
// un mot de passe QUE TU CHOISIS (`--password`). C'est parfait pour des comptes
// de test ; pour de vrais membres, ils devraient tous réinitialiser — et dans
// ce cas la bonne voie est un `pg_dump` des tables `auth.users`/`auth.identities`
// par connexion Postgres directe, qui préserve les hachages.
//
// L'uuid, lui, est PRÉSERVÉ : c'est non négociable. Toutes les tables de
// `public` référencent `auth.users(id)` ; un identifiant qui change casse tout.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { TABLES, REFERENCE, BUCKETS } = require('./lib/migration-plan');

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const has = (n) => args.includes(`--${n}`);

const DRY = has('dry-run');
const RESET_REF = has('reset-ref');
const PAGE = Number(flag('page', '1000')) || 1000;
const PASSWORD = flag('password');

const SRC_URL = process.env.SUPABASE_URL;
const SRC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DST_URL = flag('dest-url') || process.env.DEST_SUPABASE_URL;
const DST_KEY = flag('dest-key') || process.env.DEST_SUPABASE_SERVICE_ROLE_KEY;

function mourir(m) { console.error(`❌ ${m}`); process.exit(1); }
if (!SRC_URL || !SRC_KEY || /your-service|placeholder/i.test(SRC_KEY)) {
  mourir('SOURCE : SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans .env');
}
if (!DST_URL || !DST_KEY) mourir('DESTINATION : --dest-url=… --dest-key=… requis');
if (SRC_URL === DST_URL) mourir('source et destination IDENTIQUES — refus');
if (!has('skip-auth') && !DRY && !PASSWORD) {
  mourir('--password=<…> requis pour recréer les comptes (ou --skip-auth s’ils existent déjà)');
}

const o = { auth: { autoRefreshToken: false, persistSession: false } };
const src = createClient(SRC_URL, SRC_KEY, o);
const dst = createClient(DST_URL, DST_KEY, o);

const refDe = (u) => (u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || null;

/** Tous les comptes d'un projet (l'API pagine). */
async function tousLesComptes(client) {
  const out = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth : ${error.message}`);
    out.push(...(data.users || []));
    if (!data.users || data.users.length < 1000) break;
  }
  return out;
}

/** Toute une table, page par page (PostgREST plafonne les réponses). */
async function lireTout(client, table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

// ── PHASE 1 — LES COMPTES ────────────────────────────────────────────────────
async function phaseAuth() {
  console.log('\n━━ 1. COMPTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const source = await tousLesComptes(src);
  const cible = await tousLesComptes(dst);
  const dejaLa = new Set(cible.map((u) => u.id));
  const aCreer = source.filter((u) => !dejaLa.has(u.id));

  console.log(`source ${source.length} · destination ${cible.length} · à créer ${aCreer.length}`);
  // En DRY-RUN, « N comptes à créer » est l'état NORMAL avant migration — pas un
  // échec. Renvoyer `aCreer.length === 0` faisait conclure le script par un ⚠
  // alarmant alors que tout allait bien : un faux signal dans un outil de
  // vérification est pire qu'aucun signal, il fait douter d'une copie saine.
  if (DRY) { console.log('🧪 dry-run : aucun compte créé.'); return true; }
  if (!aCreer.length) { console.log('✅ rien à faire.'); return true; }

  let ok = 0; const rates = [];
  for (const u of aCreer) {
    // `id` est passé explicitement : c'est LUI qui doit survivre, tout `public`
    // en dépend. GoTrue l'accepte à la création.
    const { error } = await dst.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      phone: u.phone || undefined,
      user_metadata: u.user_metadata || {},
      app_metadata: u.app_metadata || {},
    });
    if (error) { rates.push(`${u.email || u.id} : ${error.message}`); continue; }
    ok += 1;
    if (ok % 25 === 0) process.stdout.write(`\r   ${ok}/${aCreer.length}…`);
  }
  process.stdout.write('\r');
  console.log(`✅ ${ok} compte(s) créé(s)${rates.length ? ` · ✖ ${rates.length} échec(s)` : ''}`);
  rates.slice(0, 5).forEach((r) => console.error(`   ✖ ${r}`));
  return rates.length === 0;
}

// ── PHASE 2 — LES DONNÉES ────────────────────────────────────────────────────
async function phaseDonnees() {
  console.log('\n━━ 2. DONNÉES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  let total = 0; const echecs = [];
  for (const { t, conflict } of TABLES) {
    let lignes;
    try { lignes = await lireTout(src, t); } catch (e) {
      console.log(`⏭  ${t.padEnd(22)} illisible (${e.message})`); continue;
    }
    if (!lignes.length) { console.log(`·  ${t.padEnd(22)} vide`); continue; }
    if (DRY) { console.log(`🧪 ${t.padEnd(22)} ${String(lignes.length).padStart(6)}`); total += lignes.length; continue; }

    if (RESET_REF && REFERENCE.has(t)) {
      const { error } = await dst.from(t).delete().neq('code', ' ');
      if (error) console.warn(`   ⚠ purge ${t} : ${error.message}`);
    }
    let ecrits = 0; let ko = false;
    for (let i = 0; i < lignes.length && !ko; i += PAGE) {
      const lot = lignes.slice(i, i + PAGE);
      const { error } = await dst.from(t).upsert(lot, { onConflict: conflict });
      if (error) { console.error(`❌ ${t} : ${error.message}`); echecs.push(t); ko = true; break; }
      ecrits += lot.length;
    }
    if (!ko) console.log(`✅ ${t.padEnd(22)} ${String(ecrits).padStart(6)} / ${lignes.length}`);
    total += ecrits;
  }
  console.log(`── ${total} ligne(s), ${echecs.length} table(s) en échec`);
  return echecs.length === 0;
}

// ── PHASE 3 — LES FICHIERS ───────────────────────────────────────────────────
async function lister(client, bucket, prefixe = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage.from(bucket)
      .list(prefixe, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`${bucket}/${prefixe} : ${error.message}`);
    if (!data || !data.length) break;
    for (const e of data) {
      const chemin = prefixe ? `${prefixe}/${e.name}` : e.name;
      // Un « dossier » n'a pas de métadonnées : c'est ainsi qu'on le reconnaît.
      if (e.id === null || !e.metadata) out.push(...await lister(client, bucket, chemin));
      else out.push(chemin);
    }
    if (data.length < 100) break;
  }
  return out;
}

async function phaseFichiers() {
  console.log('\n━━ 3. FICHIERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  let total = 0; let echecs = 0;
  for (const b of BUCKETS) {
    const { data: existant } = await dst.storage.getBucket(b.nom);
    if (existant && existant.public !== b.public) {
      console.error(`❌ ${b.nom} est ${existant.public ? 'PUBLIC' : 'PRIVÉ'} `
        + `alors qu'il doit être ${b.public ? 'PUBLIC' : 'PRIVÉ'} — corrige-le au dashboard.`);
      console.error('   Je ne bascule pas la visibilité tout seul : sur les selfies de');
      console.error('   vérification ou le chat, l\'erreur serait une fuite de données.');
      echecs += 1; continue;
    }
    if (!existant && !DRY) {
      const { error } = await dst.storage.createBucket(b.nom, { public: b.public });
      if (error) { console.error(`❌ création ${b.nom} : ${error.message}`); echecs += 1; continue; }
      console.log(`📦 ${b.nom} créé (${b.public ? 'public' : 'privé'})`);
    }

    let fichiers;
    try { fichiers = await lister(src, b.nom); } catch (e) {
      console.error(`❌ ${b.nom} : ${e.message}`); echecs += 1; continue;
    }
    console.log(`${b.nom.padEnd(22)} ${String(fichiers.length).padStart(5)} fichier(s)`);
    if (DRY || !fichiers.length) { total += fichiers.length; continue; }

    let ok = 0;
    for (let i = 0; i < fichiers.length; i += 4) {
      await Promise.all(fichiers.slice(i, i + 4).map(async (chemin) => {
        try {
          const { data, error } = await src.storage.from(b.nom).download(chemin);
          if (error) throw new Error(error.message);
          const buf = Buffer.from(await data.arrayBuffer());
          const { error: up } = await dst.storage.from(b.nom)
            .upload(chemin, buf, { contentType: data.type || undefined, upsert: true });
          if (up) throw new Error(up.message);
          ok += 1;
        } catch (e) { echecs += 1; console.error(`   ✖ ${b.nom}/${chemin} : ${e.message}`); }
      }));
      process.stdout.write(`\r   ${ok}/${fichiers.length}…`);
    }
    process.stdout.write('\r');
    console.log(`   ✅ ${ok} copié(s)`);
    total += ok;
  }
  console.log(`── ${total} fichier(s), ${echecs} échec(s)`);
  return echecs === 0;
}

(async () => {
  console.log(`SOURCE      ${SRC_URL}`);
  console.log(`DESTINATION ${DST_URL}`);
  if (DRY) console.log('🧪 DRY-RUN : lecture seule, aucune écriture.');

  let sain = true;
  if (!has('skip-auth')) sain = await phaseAuth() && sain;
  // Les comptes conditionnent TOUT le reste : `profiles.id` référence
  // `auth.users(id)`. On s'arrête plutôt que de copier à moitié.
  if (!sain && !DRY) mourir('des comptes manquent — migration interrompue avant les données.');
  if (!has('skip-data')) sain = await phaseDonnees() && sain;
  if (!has('skip-files')) sain = await phaseFichiers() && sain;

  const vieux = refDe(SRC_URL); const neuf = refDe(DST_URL);
  if (vieux && neuf) {
    console.log('\n━━ 4. RÉÉCRITURE DES URL — SQL Editor de la DESTINATION ━━━━');
    console.log('(les URL stockées pointent encore vers l\'ancien projet)\n');
    console.log(`update public.profiles set avatar_url = replace(avatar_url, '${vieux}', '${neuf}') where avatar_url like '%${vieux}%';`);
    console.log(`update public.profile_photos set`);
    console.log(`  url           = replace(url,           '${vieux}', '${neuf}'),`);
    console.log(`  blur_url      = replace(blur_url,      '${vieux}', '${neuf}'),`);
    console.log(`  blur_hero_url = replace(blur_hero_url, '${vieux}', '${neuf}')`);
    console.log(`where url like '%${vieux}%' or blur_url like '%${vieux}%' or blur_hero_url like '%${vieux}%';`);
    console.log(`update public.aventure_graphs set data = replace(data::text, '${vieux}', '${neuf}')::jsonb where data::text like '%${vieux}%';`);
    console.log('\n(messages.media_path et verification_requests.selfie_path stockent des');
    console.log(' CHEMINS, pas des URL : rien à réécrire.)');
  }
  console.log(`\n${sain ? '✅' : '⚠'} Terminé.`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
