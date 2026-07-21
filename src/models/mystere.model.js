'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MODÈLE MYSTÈRE — l'I/O Supabase du job de passe (service_role, bypass RLS).
// Aussi MINCE que possible : toute la logique vit dans le service (testable).
//
// ⚠ V1 « qui fonctionne maintenant » : l'éligibilité réutilise `candidates()`
// (mêmes filtres durs + préférences que le deck) une fois PAR personne — O(n)
// requêtes. Correct, mais pas optimisé pour l'échelle : à batcher quand le
// vivier grandira. Le score injecté est la compatibilité d'attributs
// (`picks.compatibilityScore`) ; le goût appris s'y branchera plus tard sans
// toucher au reste (c'est pour ça que le score est injecté).
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../config/supabase');
const { candidates } = require('./discovery.model');
const { compatibilityScore } = require('../domain/picks');
const { roleDe, partenaireDe, etatApresIssue } = require('../domain/mystere');
const { grapheRuntime } = require('./graphs.model');
const { trouveEpreuveFinale } = require('../domain/aventure');
const credits = require('./credits.model');

const LAST_PASS_KEY = 'mystere.last_pass_at';

// ── Réglages (app_settings) → forme attendue par le domaine ──────────────────
async function loadConfig() {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', 'mystere.%');
  const m = new Map((data || []).map((r) => [r.key, r.value]));
  const num = (k, d) => (m.has(k) ? Number(m.get(k)) : d);
  return {
    heureTirageUtc: num('mystere.draw_hour_utc', 21),
    fenetreMinutes: num('mystere.window_minutes', 120),
    pasMinutes: num('mystere.pass_minutes', 10),
    plancherFenetre: num('mystere.floor_in_window', 10),
    plancherHorsFenetre: num('mystere.floor_out_window', 20),
    assortativeWeight: num('mystere.assortative_weight', 20),
  };
}

async function getLastPassAt() {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', LAST_PASS_KEY).maybeSingle();
  return data ? Number(data.value) : null;
}

async function setLastPassAt(ts) {
  await supabase.from('app_settings')
    .upsert({ key: LAST_PASS_KEY, value: ts, updated_at: new Date().toISOString() });
}

// ── Les paires ───────────────────────────────────────────────────────────────

/** Ordonne (low < high) comme l'exige la contrainte de la table. */
function ordonner(a, b) { return a < b ? [a, b] : [b, a]; }

/** Propositions non commencées et périmées → à dissoudre (auto-réparation). */
async function loadStaleProposed(before) {
  const { data } = await supabase
    .from('mystere_pairs')
    .select('user_low, user_high')
    .eq('state', 'proposed')
    .lt('drawn_at', new Date(before).toISOString());
  return (data || []).map((r) => [r.user_low, r.user_high]);
}

async function dissolvePairs(pairs) {
  for (const [a, b] of pairs) {
    const [low, high] = ordonner(a, b);
    await supabase.from('mystere_pairs')
      .update({ state: 'dissolved', updated_at: new Date().toISOString() })
      .eq('user_low', low).eq('user_high', high).eq('state', 'proposed');
  }
}

/** Aventures commencées : verrouillées, jamais resubstituées. */
async function loadLockedPairs() {
  const { data } = await supabase
    .from('mystere_pairs')
    .select('user_low, user_high')
    .eq('state', 'active');
  return (data || []).map((r) => [r.user_low, r.user_high]);
}

async function writePairs(pairs) {
  if (!pairs.length) return;
  const rows = pairs.map(([a, b]) => {
    const [low, high] = ordonner(a, b);
    return { user_low: low, user_high: high, state: 'proposed' };
  });
  // Le trigger « un seul mystère actif » refuse toute paire dont un participant
  // est déjà pris — on insère une par une pour qu'un refus n'annule pas les autres.
  for (const row of rows) {
    const { error } = await supabase.from('mystere_pairs').insert(row);
    if (error && !/actif/.test(error.message)) throw error;
  }
}

// ── Le vivier + l'éligibilité réciproque ─────────────────────────────────────

/** Désirabilité [0,1], NEUTRE 0.5 à froid (sous le seuil d'impressions). */
function desirabilite(eng) {
  const e = Array.isArray(eng) ? eng[0] : eng;
  if (!e || (e.impressions || 0) < 20) return 0.5;
  const taux = (e.likes_received || 0) / e.impressions;
  return Math.max(0, Math.min(1, taux / 0.6)); // 0.6 de like-rate = plafond
}

async function loadVivier() {
  // Le vivier : découvrables, onboardés, non supprimés, non incognito.
  const { data: rows } = await supabase
    .from('profiles')
    .select('id, spoken_languages, bio, is_verified, '
      + 'profile_interests(interest_id), profile_engagement(impressions, likes_received)')
    .is('deleted_at', null)
    .eq('onboarding_done', true)
    .eq('is_discoverable', true)
    .eq('incognito', false);

  const profils = new Map();
  for (const r of rows || []) {
    profils.set(r.id, {
      id: r.id,
      interets: (r.profile_interests || []).map((i) => ({ code: i.interest_id })),
      langues: r.spoken_languages || [],
      bio: r.bio,
      estVerifie: r.is_verified,
      desirabilite: desirabilite(r.profile_engagement),
    });
  }

  // Éligibilité : qui CHACUN peut voir (mêmes filtres durs que le deck). O(n).
  const eligibles = new Map();
  for (const id of profils.keys()) {
    try {
      const deck = await candidates(id, { limit: 500 });
      eligibles.set(id, deck.map((c) => c.id));
    } catch {
      eligibles.set(id, []); // un échec isolé n'annule pas toute la passe
    }
  }
  return { profils, eligibles };
}

// ── Cycle de vie d'une paire (mon Mystère → démarrer → révéler) ──────────────

/** La paire NON TERMINALE de `userId` (proposée ou active), ou null. */
async function pairForUser(userId) {
  const { data } = await supabase
    .from('mystere_pairs')
    .select('id, user_low, user_high, state')
    .in('state', ['proposed', 'active'])
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .maybeSingle();
  if (!data) return null;
  return {
    pairId: data.id,
    partnerId: partenaireDe(data, userId),
    role: roleDe(data, userId),
    state: data.state,
  };
}

/**
 * Lancer l'Aventure : verrouille la paire (proposed → active) et crée sa
 * session si elle n'existe pas. Idempotent : rappelé, il rend la même session.
 */
async function startAdventure(userId, { graphId, startNode }) {
  const p = await pairForUser(userId);
  if (!p) return null;

  await supabase.from('mystere_pairs')
    .update({ state: 'active', updated_at: new Date().toISOString() })
    .eq('id', p.pairId).eq('state', 'proposed');

  const { data: exist } = await supabase
    .from('aventure_sessions').select('id, current_node').eq('pair_id', p.pairId).maybeSingle();
  if (exist) return { sessionId: exist.id, role: p.role, graphId, startNode: exist.current_node };

  const { data: s, error } = await supabase
    .from('aventure_sessions')
    .insert({ pair_id: p.pairId, graph_id: graphId, current_node: startNode })
    .select('id').single();
  if (error) throw error;
  return { sessionId: s.id, role: p.role, graphId, startNode };
}

/**
 * Clore l'Aventure sur son issue. 'match' → on crée le MATCH (la vraie photo
 * passe alors par les routes existantes), 'echec'/'left' → on clôt sans match.
 * Renvoie l'id du match créé, ou null.
 */
async function revealAndMatch(pairId, issue) {
  const etat = etatApresIssue(issue);
  if (!etat) throw new Error(`issue inconnue : ${issue}`);

  const { data: pair } = await supabase
    .from('mystere_pairs').select('user_low, user_high').eq('id', pairId).single();

  await supabase.from('mystere_pairs')
    .update({ state: etat, updated_at: new Date().toISOString() }).eq('id', pairId);
  await supabase.from('aventure_sessions')
    .update({ outcome: issue, updated_at: new Date().toISOString() }).eq('pair_id', pairId);

  if (issue !== 'match') return null;
  const { data: m, error } = await supabase.from('matches')
    .upsert(
      { user_low: pair.user_low, user_high: pair.user_high, last_message_at: new Date().toISOString() },
      { onConflict: 'user_low,user_high' },
    )
    .select('id').single();
  if (error) throw error;
  return m.id;
}

// ── I/O de la SESSION D'AVENTURE (ce que le service de résolution attend) ─────
// Ces fonctions sont les `deps` que `aventure.service.soumettre` câble. Le
// service est testé avec des fakes ; ici c'est le vrai Supabase, service_role
// (bypass RLS — le backend est autoritaire).

/** La session, dans la forme EXACTE que le service lit (camelCase, tours). */
async function getSession(sessionId) {
  const { data } = await supabase
    .from('aventure_sessions')
    .select('id, pair_id, graph_id, current_node, joker_used, tours_desaccord, outcome')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    pairId: data.pair_id,
    graphId: data.graph_id,
    currentNode: data.current_node,
    jokerUsed: data.joker_used,
    toursDesaccord: data.tours_desaccord ?? 0,
    outcome: data.outcome,
  };
}

/** Mon rôle ('a'/'b') dans une paire donnée — via le domaine, pas de SQL de rôle. */
async function roleOf(pairId, userId) {
  const { data } = await supabase
    .from('mystere_pairs').select('user_low, user_high').eq('id', pairId).maybeSingle();
  return data ? roleDe(data, userId) : null;
}

/**
 * Enregistre MA réponse pour le nœud courant. UPSERT sur (session, node, role) :
 * répondre deux fois (reconnexion, double-tap) écrase au lieu de dupliquer — la
 * contrainte unique garantit qu'un rôle n'a qu'une réponse par nœud.
 */
async function recordAnswer({ sessionId, nodeId, role, answerIndex = null, message = null }) {
  const { error } = await supabase
    .from('aventure_answers')
    .upsert(
      { session_id: sessionId, node_id: nodeId, role, answer_index: answerIndex, message_text: message },
      { onConflict: 'session_id,node_id,role' },
    );
  if (error) throw error;
}

/** Qui a répondu sur ce nœud, et quoi. `a`/`b` = index de choix (null pour un intime). */
async function answersForNode(sessionId, nodeId) {
  const { data } = await supabase
    .from('aventure_answers')
    .select('role, answer_index')
    .eq('session_id', sessionId)
    .eq('node_id', nodeId);
  const byRole = new Map((data || []).map((r) => [r.role, r]));
  const a = byRole.get('a');
  const b = byRole.get('b');
  return {
    aRepondu: !!a,
    bRepondu: !!b,
    a: a ? a.answer_index : null,
    b: b ? b.answer_index : null,
  };
}

/**
 * Fait avancer la session. `clearAnswers` efface les réponses DU NŒUD OÙ L'ON
 * ARRIVE : en boucle de désaccord (même nœud) ça remet la question à zéro ; en
 * avançant (nouveau nœud) c'est un no-op (il n'a pas encore de réponses).
 */
async function advanceSession(sessionId, { currentNode, toursDesaccord = 0, outcome, clearAnswers = false }) {
  const patch = {
    current_node: currentNode,
    tours_desaccord: toursDesaccord,
    updated_at: new Date().toISOString(),
  };
  if (outcome !== undefined) patch.outcome = outcome; // `null` remet à « en cours »
  const { error } = await supabase.from('aventure_sessions').update(patch).eq('id', sessionId);
  if (error) throw error;
  if (clearAnswers) {
    await supabase.from('aventure_answers')
      .delete().eq('session_id', sessionId).eq('node_id', currentNode);
  }
}

/** La session active de `userId` (pour soumettre une réponse SANS lui faire confiance sur l'id). */
async function sessionForUser(userId) {
  const p = await pairForUser(userId);
  if (!p || p.state !== 'active') return null;
  const { data } = await supabase
    .from('aventure_sessions').select('id').eq('pair_id', p.pairId).maybeSingle();
  return data ? { sessionId: data.id, pairId: p.pairId, role: p.role } : null;
}

/**
 * LE PARTENAIRE RÉVÉLÉ — l'autre membre de la paire GAGNÉE la plus récente.
 * Après une victoire, l'identité n'est plus secrète (ils sont matchés) : le
 * client peut afficher le vrai profil. Null si aucune paire gagnée.
 */
async function revealedPartner(userId) {
  const { data } = await supabase
    .from('mystere_pairs')
    .select('user_low, user_high, updated_at')
    .eq('state', 'won')
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? partenaireDe(data, userId) : null;
}

/**
 * LE JOKER — le seul achat du parcours. Il dépense 1 Joker, renvoie à l'épreuve
 * FINALE et pose `joker_used` : la relecture réussira (cf. `resoudreEtape`), donc
 * il achète littéralement la révélation. Autoritaire : le client ne peut pas se
 * poser `joker_used` lui-même (la session est en écriture backend seule).
 *
 * Renvoie { error } sans jamais débiter si quelque chose manque :
 *   'no-session' (aucune aventure active) · 'no-joker' (solde vide, → 402).
 */
async function playJoker(userId) {
  const p = await pairForUser(userId);
  if (!p || p.state !== 'active') return { error: 'no-session' };
  const { data: sess } = await supabase
    .from('aventure_sessions').select('id, graph_id').eq('pair_id', p.pairId).maybeSingle();
  if (!sess) return { error: 'no-session' };
  const finale = trouveEpreuveFinale(grapheRuntime(sess.graph_id));
  if (!finale) return { error: 'no-final' };

  // On débite APRÈS avoir tout validé, AVANT d'appliquer : un Joker n'est jamais
  // pris pour rien (les cas d'échec ci-dessus rendent la main sans débiter).
  const ok = await credits.spendJoker(userId);
  if (!ok) return { error: 'no-joker' };

  await supabase.from('aventure_sessions').update({
    joker_used: true, current_node: finale, tours_desaccord: 0, outcome: null,
    updated_at: new Date().toISOString(),
  }).eq('id', sess.id);
  // Table rase des réponses : la dernière épreuve se rejoue proprement.
  await supabase.from('aventure_answers').delete().eq('session_id', sess.id);
  return { ok: true, sessionId: sess.id, currentNode: finale, role: p.role };
}

module.exports = {
  loadConfig, getLastPassAt, setLastPassAt,
  loadStaleProposed, dissolvePairs, loadLockedPairs, writePairs, loadVivier,
  pairForUser, startAdventure, revealAndMatch,
  // I/O de session (deps du service de résolution) + cycle Joker
  getSession, roleOf, recordAnswer, answersForNode, advanceSession, sessionForUser, playJoker, revealedPartner,
  scoreOf: compatibilityScore,
  desirabiliteOf: (p) => (Number.isFinite(p?.desirabilite) ? p.desirabilite : 0.5),
};
