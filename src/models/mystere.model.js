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

module.exports = {
  loadConfig, getLastPassAt, setLastPassAt,
  loadStaleProposed, dissolvePairs, loadLockedPairs, writePairs, loadVivier,
  pairForUser, startAdventure, revealAndMatch,
  scoreOf: compatibilityScore,
  desirabiliteOf: (p) => (Number.isFinite(p?.desirabilite) ? p.desirabilite : 0.5),
};
