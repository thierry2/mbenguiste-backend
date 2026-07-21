'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SONDE — CE COMPTE PEUT-IL RECEVOIR UNE PUSH ?
//
// `test-push.js` prouve que la chaîne Expo → FCM → appareil fonctionne. Cette
// sonde-ci répond à l'autre moitié : le SERVEUR sait-il où joindre ce compte ?
//
// Deux conditions, et chacune échoue EN SILENCE aujourd'hui :
//   1. `profiles.push_token` est renseigné (sinon `sendPush` log « pas de token
//      valide » et sort — mais ce log est côté serveur, invisible en local) ;
//   2. `profiles.notif_push` n'est pas `false` (le réglage utilisateur coupe
//      toutes les notifications système, sans que rien ne le signale).
//
// LECTURE SEULE : cette sonde ne modifie jamais rien.
//
// USAGE :
//   node scripts/check-push-setup.js seedw090@mbenguiste.dev seedm090@mbenguiste.dev
//   (emails ou uuid, autant qu'on veut)
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

(async () => {
  const idents = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!idents.length) {
    console.error('Usage: node scripts/check-push-setup.js <email|uuid> [<email|uuid>…]');
    process.exit(1);
  }

  // Un même token sur DEUX comptes = le 2e appareil a écrasé le 1er
  // (`profiles.push_token` est singulier). On le détecte en fin de passe.
  const tokens = new Map();
  let bloquants = 0;

  for (const ident of idents) {
    const id = await resolveId(ident);
    const { data } = await sb
      .from('profiles')
      .select('id, first_name, push_token, notif_push')
      .eq('id', id)
      .maybeSingle();

    console.log(`\n── ${ident}`);
    if (!data) { console.log('   ❌ profil introuvable'); bloquants += 1; continue; }
    console.log(`   prénom      ${data.first_name || '—'}`);

    if (!data.push_token) {
      console.log('   push_token  ❌ VIDE — le serveur ne sait pas où joindre ce compte.');
      console.log('               → connecte-toi avec CE compte sur l’appareil et regarde');
      console.log('                 « [push:…] token ENREGISTRÉ » dans les logs Metro.');
      bloquants += 1;
    } else if (!String(data.push_token).startsWith('ExponentPushToken')) {
      console.log(`   push_token  ❌ FORME INVALIDE (${String(data.push_token).slice(0, 24)}…)`);
      bloquants += 1;
    } else {
      console.log(`   push_token  ✔ ${data.push_token}`);
      const vus = tokens.get(data.push_token) || [];
      vus.push(ident);
      tokens.set(data.push_token, vus);
    }

    if (data.notif_push === false) {
      console.log('   notif_push  ❌ FALSE — les notifications système sont coupées pour ce compte.');
      bloquants += 1;
    } else {
      console.log(`   notif_push  ✔ ${data.notif_push === null ? 'null (= activées)' : data.notif_push}`);
    }
  }

  for (const [tok, comptes] of tokens) {
    if (comptes.length > 1) {
      console.log(`\n⚠️  MÊME TOKEN sur ${comptes.length} comptes : ${comptes.join(', ')}`);
      console.log('    `profiles.push_token` est SINGULIER : le dernier appareil connecté');
      console.log('    a écrasé le précédent. Un seul des deux recevra les push.');
      console.log(`    (${tok.slice(0, 30)}…)`);
      bloquants += 1;
    }
  }

  console.log(bloquants
    ? `\n❌ ${bloquants} raison(s) pour laquelle une push n’arriverait pas.`
    : '\n✅ Rien ne bloque côté base : ces comptes sont joignables.');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
