'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FORCER une paire Mystère de test entre deux comptes — SANS passer par la passe
// (filtres + plancher + rendez-vous). Sert à tester la vraie chaîne à deux quand
// on n'a pas deux personnes / deux téléphones.
//
//   node scripts/force-mystere-pair.js <a> <b>
//     <a> <b> = emails (ex. seedw076@mbenguiste.dev) OU profileId (uuid).
//
// Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (la VRAIE clé, pas le
// placeholder). Idempotent-ish : refuse si l'un des deux a déjà un mystère actif
// (le trigger « un seul mystère actif »).
//
//   node scripts/force-mystere-pair.js <a> <b> --purge   → défait la paire (test)
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY || /your-service|xxxx|placeholder/i.test(KEY)) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants ou placeholder dans .env');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** email → profileId (via auth.users, paginé). */
async function resolveId(ident) {
  if (isUuid(ident)) return ident;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = (data.users || []).find((x) => (x.email || '').toLowerCase() === ident.toLowerCase());
    if (u) return u.id;
    if (!data.users || data.users.length < 200) break;
  }
  throw new Error(`compte introuvable : ${ident}`);
}

async function info(id) {
  const { data } = await sb.from('profiles').select('id, first_name, gender_id').eq('id', id).maybeSingle();
  return data;
}

(async () => {
  const args = process.argv.slice(2);
  const purge = args.includes('--purge');
  const [aRaw, bRaw] = args.filter((a) => !a.startsWith('--'));
  if (!aRaw || !bRaw) { console.error('Usage: node scripts/force-mystere-pair.js <a> <b> [--purge]'); process.exit(1); }

  const a = await resolveId(aRaw);
  const b = await resolveId(bRaw);
  if (a === b) { console.error('❌ a et b sont le même compte'); process.exit(1); }
  const [low, high] = a < b ? [a, b] : [b, a];

  const ia = await info(a); const ib = await info(b);
  console.log(`A = ${ia?.first_name || '?'} (${a})  genre ${ia?.gender_id}`);
  console.log(`B = ${ib?.first_name || '?'} (${b})  genre ${ib?.gender_id}`);
  if (ia && ib && ia.gender_id === ib.gender_id) console.log('⚠️  même genre — le mécanisme marche quand même, mais ce n’est pas « sexe opposé ».');

  if (purge) {
    const { error } = await sb.from('mystere_pairs').delete().eq('user_low', low).eq('user_high', high);
    if (error) throw error;
    console.log('🧹 Paire supprimée (et sa session/réponses en cascade).');
    return;
  }

  const { data, error } = await sb.from('mystere_pairs')
    .insert({ user_low: low, user_high: high, state: 'proposed' })
    .select('id, state').single();
  if (error) { console.error('❌ Insertion refusée :', error.message); process.exit(1); }
  console.log(`✅ Paire forcée : ${data.id} (${data.state}). Ouvre l’app / la page de test pour lancer l’aventure.`);

  // « Un mystère t'attend » aux deux membres (anonyme, best-effort) — pour tester
  // la découverte par notification comme en vrai. N'échoue jamais la commande.
  try {
    const notif = require('../src/services/notification.service');
    await Promise.allSettled([notif.onMystereProposed(a), notif.onMystereProposed(b)]);
    console.log('🔔 Notification « un mystère t\'attend » envoyée (si push activés).');
  } catch (e) { console.warn('⚠️  notif non envoyée :', e?.message); }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
