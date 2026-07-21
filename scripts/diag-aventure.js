'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SONDE — POURQUOI CETTE AVENTURE EST-ELLE BLOQUÉE ?
//
// Quand les deux téléphones restent sur « ta réponse est partie », une seule
// question compte : le SERVEUR voit-il les deux réponses ? Tout le reste en
// découle. S'il n'en voit qu'une, il attend — et il a raison d'attendre.
//
// Cette sonde lit l'état RÉEL (paire, session, réponses par rôle) et dit ce qui
// manque. À lancer PENDANT que c'est bloqué : l'état est figé, c'est le moment
// idéal pour l'observer.
//
// LECTURE SEULE.
//
// USAGE :  node scripts/diag-aventure.js <email|uuid>
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
  const ident = process.argv[2];
  if (!ident) { console.error('Usage: node scripts/diag-aventure.js <email|uuid>'); process.exit(1); }
  const uid = await resolveId(ident);

  const { data: pair } = await sb.from('mystere_pairs')
    .select('id, user_low, user_high, state')
    .in('state', ['proposed', 'active'])
    .or(`user_low.eq.${uid},user_high.eq.${uid}`)
    .maybeSingle();
  if (!pair) { console.log('\n❌ aucune paire vivante pour ce compte.'); return; }

  console.log('\n── PAIRE');
  console.log(`   id     ${pair.id}`);
  console.log(`   état   ${pair.state}`);
  console.log(`   a(low) ${pair.user_low}`);
  console.log(`   b(high)${pair.user_high}`);

  const { data: s } = await sb.from('aventure_sessions')
    .select('id, graph_id, current_node, joker_used, outcome, tours_desaccord, last_issue, negocier, clip_a_jouer')
    .eq('pair_id', pair.id).maybeSingle();
  if (!s) { console.log('\n❌ aucune session (l’aventure n’a jamais démarré).'); return; }

  console.log('\n── SESSION');
  for (const [k, v] of Object.entries(s)) console.log(`   ${k.padEnd(16)} ${v === null ? 'null' : v}`);

  const { data: rep } = await sb.from('aventure_answers')
    .select('node_id, role, answer_index, message_text, created_at')
    .eq('session_id', s.id)
    .order('created_at');

  console.log(`\n── RÉPONSES (${(rep || []).length} au total)`);
  for (const r of rep || []) {
    const val = r.answer_index !== null ? `choix ${r.answer_index}` : `« ${(r.message_text || '').slice(0, 40)} »`;
    console.log(`   ${String(r.node_id).padEnd(8)} rôle ${r.role}  ${val}`);
  }

  // ── LE VERDICT ──
  // Le nœud courant est-il TERMINAL (une fin) ? Une fin ne se résout pas : des
  // réponses posées dessus sont des fantômes (le bug du 22/07).
  const estFin = /^fin[_-]/i.test(s.current_node) || s.outcome === 'echec' || s.outcome === 'match' || s.outcome === 'left';
  const surNoeud = (rep || []).filter((r) => r.node_id === s.current_node);
  const roles = new Set(surNoeud.map((r) => r.role));
  console.log(`\n── VERDICT (nœud courant : ${s.current_node})`);
  if (estFin) {
    console.log(`   ⚑ Le nœud courant est une FIN (outcome: ${s.outcome}).`);
    if (surNoeud.length) {
      console.log(`     ❌ ${surNoeud.length} réponse(s) FANTÔME enregistrée(s) sur cette fin.`);
      console.log('        Une fin ne prend aucune réponse — c’est le bug corrigé le 22/07.');
      console.log('        Purge la paire pour repartir propre (force-mystere-pair --purge).');
    } else {
      console.log('     → l’aventure est TERMINÉE ; les clients doivent afficher l’écran de fin.');
      console.log('        S’ils attendent encore, c’est le rendu qui n’a pas suivi (Realtime manqué).');
    }
  } else if (roles.size >= 2) {
    console.log('   ✔ les DEUX rôles ont répondu sur le nœud courant.');
    console.log('     → le serveur aurait dû résoudre. Si les écrans attendent encore,');
    console.log('       c’est le RENDU client qui n’a pas suivi, pas la résolution.');
  } else if (roles.size === 1) {
    console.log(`   ⏳ SEUL le rôle « ${[...roles][0]} » a répondu sur ce nœud.`);
    console.log('     → le serveur attend l’autre, et il a raison. Regarde si la réponse');
    console.log('       de l’autre a été enregistrée sur un AUTRE nœud (liste ci-dessus) :');
    console.log('       cela voudrait dire que les deux clients n’étaient pas sur la même étape.');
  } else {
    console.log('   ❌ AUCUNE réponse sur le nœud courant.');
    console.log('     → les deux clients croient avoir répondu, mais rien n’est enregistré ici.');
    console.log('       Vérifie sur quel nœud leurs réponses sont parties (liste ci-dessus).');
  }
  if (s.joker_used) {
    console.log('\n   ℹ Joker déjà joué : la finale doit RÉUSSIR quoi que dise le graphe.');
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
