'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// COPIER LES FICHIERS DU STORAGE VERS UN AUTRE PROJET SUPABASE.
//
//   node scripts/migrate-storage.js --dest-url=https://xxx.supabase.co --dest-key=<service_role>
//
//   --dry-run       liste et compte, ne copie RIEN (à lancer en premier)
//   --only=photos   ne traite que ce(s) bucket(s)
//   --concurrence=4 fichiers copiés en parallèle
//
// ─────────────────────────────────────────────────────────────────────────────
// LA VISIBILITÉ DES BUCKETS EST UNE QUESTION DE VIE PRIVÉE, PAS D'AFFICHAGE.
//
//   photos               PUBLIC  — photos de profil (visibles en découverte)
//   aventure             PUBLIC  — clips de jeu (ne portent aucune identité)
//   chat-media           PRIVÉ   — images de messages, servies par URL signée
//   verification-selfies PRIVÉ   — selfies de vérification d'identité
//
// Créer `chat-media` ou `verification-selfies` en public, c'est exposer des
// conversations privées et des pièces d'identité à quiconque devine une URL.
// Le script CRÉE les buckets manquants avec la bonne visibilité, et REFUSE de
// continuer si un bucket existant côté destination a la mauvaise — il ne la
// corrige pas tout seul : basculer un bucket est une décision, pas un détail.
//
// ⚠ IL NE RÉÉCRIT PAS LES URL EN BASE. `profile_photos.url/blur_url/
// blur_hero_url`, `profiles.avatar_url` et les clips dans `aventure_graphs.data`
// contiennent l'identifiant de l'ANCIEN projet. Le SQL de réécriture est affiché
// à la fin — instantané en une requête, là où un parcours ligne à ligne serait
// long et faillible. `messages.media_path` et `verification_requests.selfie_path`
// stockent des CHEMINS, pas des URL : ils n'ont rien à réécrire.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { BUCKETS } = require('./lib/migration-plan');


const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const DRY = args.includes('--dry-run');
const ONLY = (flag('only') || '').split(',').filter(Boolean);
const CONC = Math.max(1, Number(flag('concurrence', '4')) || 4);

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

const o = { auth: { autoRefreshToken: false, persistSession: false } };
const src = createClient(SRC_URL, SRC_KEY, o);
const dst = createClient(DST_URL, DST_KEY, o);

/**
 * Liste RÉCURSIVE d'un bucket. `list()` ne rend qu'un niveau et pagine par 100 :
 * sans récursion ni pagination on ne copierait que le premier dossier, et sans
 * s'en apercevoir (aucune erreur — juste des fichiers manquants).
 */
async function lister(client, bucket, prefixe = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage.from(bucket)
      .list(prefixe, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`${bucket}/${prefixe} : ${error.message}`);
    if (!data || !data.length) break;
    for (const e of data) {
      const chemin = prefixe ? `${prefixe}/${e.name}` : e.name;
      // Un « dossier » n'a pas de métadonnées : c'est ainsi qu'on le distingue.
      if (e.id === null || !e.metadata) out.push(...await lister(client, bucket, chemin));
      else out.push({ chemin, taille: e.metadata?.size ?? 0 });
    }
    if (data.length < 100) break;
  }
  return out;
}

/** Prépare le bucket destination — et refuse une visibilité incohérente. */
async function preparerBucket({ nom, public: pub }) {
  const { data: existant } = await dst.storage.getBucket(nom);
  if (!existant) {
    if (DRY) { console.log(`🧪 ${nom} : à CRÉER (${pub ? 'public' : 'privé'})`); return true; }
    const { error } = await dst.storage.createBucket(nom, { public: pub });
    if (error) { console.error(`❌ création ${nom} : ${error.message}`); return false; }
    console.log(`📦 ${nom} créé (${pub ? 'public' : 'privé'})`);
    return true;
  }
  if (existant.public !== pub) {
    console.error(`❌ ${nom} existe en ${existant.public ? 'PUBLIC' : 'PRIVÉ'} `
      + `alors qu'il doit être ${pub ? 'PUBLIC' : 'PRIVÉ'}.`);
    console.error('   Corrige-le dans le dashboard puis relance — je ne bascule pas');
    console.error('   la visibilité d\'un bucket tout seul : sur les selfies de');
    console.error('   vérification ou les images de chat, l\'erreur serait une fuite.');
    return false;
  }
  return true;
}

async function copier(bucket, fichiers) {
  let ok = 0; let ko = 0;
  for (let i = 0; i < fichiers.length; i += CONC) {
    const lot = fichiers.slice(i, i + CONC);
    await Promise.all(lot.map(async ({ chemin }) => {
      try {
        const { data, error } = await src.storage.from(bucket).download(chemin);
        if (error) throw new Error(error.message);
        const buf = Buffer.from(await data.arrayBuffer());
        const { error: up } = await dst.storage.from(bucket)
          .upload(chemin, buf, { contentType: data.type || undefined, upsert: true });
        if (up) throw new Error(up.message);
        ok += 1;
      } catch (e) {
        ko += 1;
        console.error(`   ✖ ${bucket}/${chemin} : ${e.message}`);
      }
    }));
    process.stdout.write(`\r   ${ok + ko}/${fichiers.length}…`);
  }
  process.stdout.write('\r');
  return { ok, ko };
}

/** L'identifiant de projet dans `https://<ref>.supabase.co`. */
const refDe = (url) => (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || null;

(async () => {
  console.log(`SOURCE      ${SRC_URL}`);
  console.log(`DESTINATION ${DST_URL}`);
  if (DRY) console.log('🧪 DRY-RUN : lecture seule.\n');

  let total = 0; let echecs = 0;
  for (const b of BUCKETS) {
    if (ONLY.length && !ONLY.includes(b.nom)) continue;
    if (!await preparerBucket(b)) { echecs += 1; continue; }

    let fichiers;
    try { fichiers = await lister(src, b.nom); } catch (e) {
      console.error(`❌ ${b.nom} : ${e.message}`); echecs += 1; continue;
    }
    const poids = fichiers.reduce((n, f) => n + (f.taille || 0), 0);
    console.log(`${b.nom.padEnd(22)} ${String(fichiers.length).padStart(5)} fichier(s) · `
      + `${(poids / 1024 / 1024).toFixed(1)} Mo`);
    if (DRY || !fichiers.length) { total += fichiers.length; continue; }

    const r = await copier(b.nom, fichiers);
    console.log(`   ✅ ${r.ok} copié(s)${r.ko ? ` · ✖ ${r.ko} échec(s)` : ''}`);
    total += r.ok; echecs += r.ko;
  }

  console.log(`\n── ${total} fichier(s), ${echecs} échec(s)`);

  const vieux = refDe(SRC_URL); const neuf = refDe(DST_URL);
  if (vieux && neuf) {
    console.log('\n── RÉÉCRITURE DES URL — à passer dans le SQL Editor de la DESTINATION');
    console.log('   (les URL stockées pointent encore vers l\'ancien projet)\n');
    console.log(`update public.profiles set avatar_url = replace(avatar_url, '${vieux}', '${neuf}') where avatar_url like '%${vieux}%';`);
    console.log(`update public.profile_photos set`);
    console.log(`  url           = replace(url,           '${vieux}', '${neuf}'),`);
    console.log(`  blur_url      = replace(blur_url,      '${vieux}', '${neuf}'),`);
    console.log(`  blur_hero_url = replace(blur_hero_url, '${vieux}', '${neuf}')`);
    console.log(`where url like '%${vieux}%' or blur_url like '%${vieux}%' or blur_hero_url like '%${vieux}%';`);
    console.log(`update public.aventure_graphs set data = replace(data::text, '${vieux}', '${neuf}')::jsonb where data::text like '%${vieux}%';`);
    console.log('\n   (messages.media_path et verification_requests.selfie_path stockent des');
    console.log('    CHEMINS, pas des URL : ils n\'ont rien à réécrire.)');
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
