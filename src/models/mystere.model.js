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
const { roleDe, partenaireDe, etatApresIssue, attributsIndices } = require('../domain/mystere');
const { ageFromBirthDate } = require('./profile.model');
const { grapheRuntime, grapheDePaire } = require('./graphs.model');
const { progressionAventure } = require('../domain/aventureProgression');
const { trouveEpreuveFinale } = require('../domain/aventure');
const { messagesDuFil } = require('../domain/aventureFil');
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

/**
 * Insère les paires NOUVELLES (état 'proposed'). Renvoie celles RÉELLEMENT créées
 * (`[low, high]`) — le trigger « un seul mystère actif » en refuse certaines, et
 * l'appelant a besoin de savoir lesquelles ont abouti pour notifier les bons
 * membres (« un mystère t'attend »).
 */
async function writePairs(pairs) {
  if (!pairs.length) return [];
  const rows = pairs.map(([a, b]) => {
    const [low, high] = ordonner(a, b);
    return { user_low: low, user_high: high, state: 'proposed' };
  });
  // Le trigger « un seul mystère actif » refuse toute paire dont un participant
  // est déjà pris — on insère une par une pour qu'un refus n'annule pas les autres.
  const creees = [];
  for (const row of rows) {
    const { error } = await supabase.from('mystere_pairs').insert(row);
    if (error) {
      if (!/actif/.test(error.message)) throw error;
      continue; // paire refusée (un membre déjà pris) → pas de notif pour elle
    }
    creees.push([row.user_low, row.user_high]);
  }
  return creees;
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

/**
 * OUTIL DE TEST (admin) — force une paire 'proposed' entre deux membres, SANS
 * passer par la passe d'appariement (filtres + plancher). Ordonne low<high. Le
 * trigger « un seul mystère actif » refuse si l'un est déjà pris, et la clé
 * étrangère refuse un id inconnu — on remonte le message pour l'admin. Renvoie
 * { pairId } ou { error }. C'est ce qui permet de tester la VRAIE chaîne à deux
 * sans attendre le rendez-vous de minuit ni deux profils mutuellement éligibles.
 */
async function forcePair(a, b) {
  if (!a || !b || a === b) return { error: 'bad-input' };
  const [low, high] = ordonner(a, b);
  const { data, error } = await supabase.from('mystere_pairs')
    .insert({ user_low: low, user_high: high, state: 'proposed' })
    .select('id').single();
  if (error) return { error: error.message };
  return { pairId: data.id };
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
async function startAdventure(userId, opts = {}) {
  const p = await pairForUser(userId);
  if (!p) return null;

  await supabase.from('mystere_pairs')
    .update({ state: 'active', updated_at: new Date().toISOString() })
    .eq('id', p.pairId).eq('state', 'proposed');

  // Session déjà là (reprise) : on rend SON graphe — tiré au sort une seule fois,
  // à la création, puis FIXE. On lit le vrai graph_id stocké, jamais l'argument.
  const { data: exist } = await supabase
    .from('aventure_sessions')
    .select('id, graph_id, current_node, last_issue, clip_a_jouer')
    .eq('pair_id', p.pairId).maybeSingle();
  if (exist) {
    // ⚠ `etape` VIENT DU SERVEUR, jamais d'un compteur local du lecteur.
    // Le lecteur tenait `step` en état React (`useState(1)`, puis +1) : au
    // moindre remontage (redémarrage de l'app, rechargement Metro, retour sur
    // l'écran) il repartait à 1 alors que le nœud, lui, était bien restauré. Les
    // deux téléphones affichaient donc des compteurs DIFFÉRENTS pour la même
    // partie — « plus que 4 épreuves » d'un côté, « 6 » de l'autre (22/07).
    // La progression se DÉRIVE du nœud courant : c'est la seule source honnête.
    const prog = progressionAventure(grapheRuntime(exist.graph_id), exist.current_node);
    return {
      sessionId: exist.id, role: p.role, graphId: exist.graph_id,
      startNode: exist.current_node, etape: prog.etape, total: prog.total,
      // La DERNIÈRE issue résolue et son clip. Ils permettent au client de
      // rattraper une conséquence jouée pendant qu'il avait fermé l'aventure :
      // sans eux, il reprend au nœud suivant et l'issue de l'épreuve qu'il vient
      // de réussir n'est jamais montrée (cf. `consequenceARejouer`, front).
      lastIssue: exist.last_issue ?? null,
      clipAJouer: exist.clip_a_jouer ?? null,
    };
  }

  // Nouvelle session : le GRAPHE EST DÉRIVÉ DE LA PAIRE côté serveur (le client
  // ne choisit pas son scénario). Déterministe, donc l'onglet Mystère a pu
  // précharger LES BONS clips avant même que cette session existe. Repli sur
  // l'éventuel graphe fourni si la table est vide ; sinon on le dit.
  const tir = await grapheDePaire(p.pairId);
  const graphId = tir?.id ?? opts.graphId ?? null;
  const startNode = tir?.start ?? opts.startNode ?? null;
  if (!graphId || !startNode) return { error: 'no-graph' };

  const { data: s, error } = await supabase
    .from('aventure_sessions')
    .insert({ pair_id: p.pairId, graph_id: graphId, current_node: startNode })
    .select('id').single();
  if (error) throw error;
  // Session neuve : on est au départ, donc zéro étape derrière nous. On le dit
  // explicitement plutôt que de laisser le client le supposer.
  const prog = progressionAventure(grapheRuntime(graphId), startNode);
  return { sessionId: s.id, role: p.role, graphId, startNode, etape: prog.etape, total: prog.total };
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

  // On CAPTURE l'erreur : une contrainte violée (ex. état inconnu) ne doit pas
  // être avalée en silence — sinon la paire reste 'active' et verrouille ses
  // membres à vie sans que personne ne le sache (le bug 'left' du 21/07).
  const { error: eState } = await supabase.from('mystere_pairs')
    .update({ state: etat, updated_at: new Date().toISOString() }).eq('id', pairId);
  if (eState) throw eState;
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
  // ⚠ ON N'ENSEMENCE PAS ICI. Verser le fil dès la création du match faisait
  // arriver tous les messages d'un coup PENDANT la révélation : la carte et le
  // match n'avaient plus le temps d'exister, on passait directement à une
  // conversation déjà pleine. Le fil se verse à L'OUVERTURE de la conversation
  // (`semerFilAventure`, appelé par la liste des messages) — au moment où on
  // vient précisément pour le lire.
  return m.id;
}

/**
 * Verse le fil de l'Aventure (aveu + négociations) dans la conversation neuve.
 *
 * IDEMPOTENT par le même garde que `seedOpeners` : on n'écrit QUE si le fil est
 * encore vide. Un re-match, une reprise ou une course ne dupliquent rien.
 */
async function semerFilAventure(matchId) {
  if (!matchId) return;
  // Le fil n'est versé QU'UNE FOIS : dès qu'un message existe, on ne touche à
  // rien. C'est ce qui rend l'appel sûr à chaque ouverture de conversation.
  const { count } = await supabase
    .from('messages').select('id', { count: 'exact', head: true }).eq('match_id', matchId);
  if (count) return;

  // On remonte du match vers la paire par le COUPLE (les deux tables ordonnent
  // leurs membres pareil, `user_low`/`user_high`). Le match ne porte pas de
  // `pair_id` : c'est le seul lien disponible.
  const { data: m } = await supabase
    .from('matches').select('user_low, user_high').eq('id', matchId).maybeSingle();
  if (!m) return;
  const { data: pair } = await supabase
    .from('mystere_pairs').select('id, user_low, user_high')
    .eq('user_low', m.user_low).eq('user_high', m.user_high)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!pair) return;

  const { data: sess } = await supabase
    .from('aventure_sessions').select('id').eq('pair_id', pair.id).maybeSingle();
  if (!sess) return;

  const { data: rows } = await supabase
    .from('aventure_answers')
    .select('node_id, role, message_text, created_at')
    .eq('session_id', sess.id)
    .not('message_text', 'is', null);

  const messages = messagesDuFil({ rows: rows || [], pair, matchId });
  if (!messages.length) return;
  const { error } = await supabase.from('messages').insert(messages);
  if (error) throw error;
}

/**
 * TERMINER le mystère (sortie propre UNILATÉRALE) — l'un des deux décide d'y
 * mettre fin. La paire passe 'left' (état terminal, sans match) et libère les
 * DEUX membres pour un futur mystère. On clôt aussi la session s'il y en a une
 * (l'aventure avait commencé). Renvoie le partenaire à prévenir (push), ou
 * { error: 'no-pair' } s'il n'y a rien à terminer. Idempotent : rappelé, il ne
 * re-termine pas (la paire n'est déjà plus non terminale).
 */
async function leaveMystere(userId) {
  const p = await pairForUser(userId);
  if (!p) return { error: 'no-pair' };

  const { error } = await supabase.from('mystere_pairs')
    .update({ state: 'left', updated_at: new Date().toISOString() })
    .eq('id', p.pairId).in('state', ['proposed', 'active']);
  if (error) throw error;

  // La session peut ne pas exister (paire encore 'proposed', jamais lancée).
  await supabase.from('aventure_sessions')
    .update({ outcome: 'left', updated_at: new Date().toISOString() })
    .eq('pair_id', p.pairId);

  return { partnerId: p.partnerId };
}

// ── I/O de la SESSION D'AVENTURE (ce que le service de résolution attend) ─────
// Ces fonctions sont les `deps` que `aventure.service.soumettre` câble. Le
// service est testé avec des fakes ; ici c'est le vrai Supabase, service_role
// (bypass RLS — le backend est autoritaire).

/**
 * La session, dans la forme EXACTE que le service lit (camelCase, tours).
 *
 * On fait REMONTER `error` (au lieu de le passer sous silence) : une colonne
 * manquante en prod (schéma en retard sur les migrations, cf. `tours_desaccord`
 * le 21/07) transformait sinon une vraie erreur DB en `null` silencieux — le
 * contrôleur répondait « Aventure introuvable » comme si la session n'existait
 * pas, une heure de debug pour une colonne oubliée. `maybeSingle()` sans erreur
 * ET sans ligne reste un `null` légitime (pas de session) : ce n'est QUE la
 * présence d'`error` qui doit faire lever.
 */
async function getSession(sessionId) {
  const { data, error } = await supabase
    .from('aventure_sessions')
    .select(
      'id, pair_id, graph_id, current_node, joker_used, tours_desaccord, outcome, '
      + 'phase, last_issue, negocier, clip_a_jouer',
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    pairId: data.pair_id,
    graphId: data.graph_id,
    currentNode: data.current_node,
    jokerUsed: data.joker_used,
    toursDesaccord: data.tours_desaccord ?? 0,
    outcome: data.outcome,
    phase: data.phase,
    lastIssue: data.last_issue,
    negocier: !!data.negocier,
    clipAJouer: data.clip_a_jouer,
  };
}

/**
 * Les DEUX membres d'une paire, par id. Sert aux notifications de tour : le
 * service doit savoir QUI prévenir sans jamais faire confiance au client sur
 * l'identité du partenaire. `null` si la paire n'existe pas — l'appelant
 * n'invente alors personne (et n'envoie rien).
 */
/**
 * LA PROGRESSION d'une paire — `{ etape, total }` pour la jauge de l'onglet
 * (le flou de la carte EST cette jauge). Dérivée du nœud courant de la session
 * et du graphe joué, jamais d'un compteur client. Aucune session encore (paire
 * seulement proposée) → 0 franchi, mais le TOTAL du scénario qui l'attend.
 */
async function progressionDePaire(pairId) {
  const { data } = await supabase
    .from('aventure_sessions').select('graph_id, current_node').eq('pair_id', pairId).maybeSingle();
  if (data) return progressionAventure(grapheRuntime(data.graph_id), data.current_node);
  const prevu = await grapheDePaire(pairId);
  return prevu
    ? { etape: 0, total: progressionAventure(grapheRuntime(prevu.id), prevu.start).total }
    : { etape: 0, total: 0 };
}

async function membresDePaire(pairId) {
  const { data } = await supabase
    .from('mystere_pairs').select('user_low, user_high').eq('id', pairId).maybeSingle();
  return data ? [data.user_low, data.user_high] : null;
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
async function advanceSession(sessionId, {
  currentNode, toursDesaccord = 0, outcome, clearAnswers = false,
  lastIssue, negocier, clipAJouer,
}) {
  const patch = {
    current_node: currentNode,
    tours_desaccord: toursDesaccord,
    updated_at: new Date().toISOString(),
  };
  if (outcome !== undefined) patch.outcome = outcome; // `null` remet à « en cours »
  // CERVEAU UNIQUE (034) : ce que les DEUX clients liront via Realtime, au lieu
  // de le recalculer chacun sur son propre état local (cf. aventure.service).
  if (lastIssue !== undefined) patch.last_issue = lastIssue;
  if (negocier !== undefined) patch.negocier = negocier;
  if (clipAJouer !== undefined) patch.clip_a_jouer = clipAJouer;
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
    // On repart NEUTRE sur la finale : un vieux `last_issue`/`negocier` d'un tour
    // précédent ne doit pas fuiter dans la relecture (les DEUX clients suivent
    // maintenant ces champs, ils doivent refléter l'état RÉEL de la finale rejouée).
    last_issue: null, negocier: false, clip_a_jouer: null,
    updated_at: new Date().toISOString(),
  }).eq('id', sess.id);
  // ⚠ ON N'EFFACE QUE LA FINALE, plus toute la session. La table rase était
  // trop large : elle emportait l'AVEU du nœud intime et les messages de
  // négociation. Or le Joker est le chemin NORMAL vers la révélation (l'échec
  // de la finale est forcé) — donc dans un parcours gagnant typique, tout le fil
  // était déjà supprimé au moment du match, et la conversation s'ouvrait vide.
  // Ce que le Joker doit garantir, c'est que la DERNIÈRE ÉPREUVE se rejoue
  // proprement : seules SES réponses ont besoin de disparaître.
  await supabase.from('aventure_answers')
    .delete().eq('session_id', sess.id).eq('node_id', finale);
  // `pairId` remonte pour que l'appelant puisse PRÉVENIR le partenaire : le
  // Joker rouvre la dernière épreuve, sa réponse est de nouveau attendue.
  return { ok: true, sessionId: sess.id, currentNode: finale, role: p.role, pairId: p.pairId };
}

/**
 * LES INDICES RÉELS du partenaire de l'aventure EN COURS — dérivés de son profil
 * (texte seulement, JAMAIS la photo). Autoritaire : on DÉRIVE le partenaire de la
 * paire active de l'utilisateur (jamais un id fourni par le client). On sert TOUT
 * d'un coup (décision produit) ; le rythme de dévoilement est géré côté client par
 * `node.reveal`. `null` si aucune paire (pas d'aventure → pas d'indices).
 */
async function partnerIndices(userId) {
  const p = await pairForUser(userId);
  if (!p || !p.partnerId) return null;
  const { data } = await supabase
    .from('profiles')
    .select(
      'first_name, birth_date, current_city, '
      + 'interests:profile_interests(interest:interests(code, display_name)), '
      + 'prompts:profile_prompts(answer, position, prompt:prompts(code, question))',
    )
    .eq('id', p.partnerId)
    .maybeSingle();
  if (!data) return null;
  return attributsIndices(data, ageFromBirthDate(data.birth_date));
}

module.exports = {
  loadConfig, getLastPassAt, setLastPassAt,
  loadStaleProposed, dissolvePairs, loadLockedPairs, writePairs, loadVivier,
  forcePair,
  pairForUser, startAdventure, revealAndMatch, leaveMystere, semerFilAventure,
  // I/O de session (deps du service de résolution) + cycle Joker
  getSession, roleOf, membresDePaire, progressionDePaire, recordAnswer, answersForNode, advanceSession, sessionForUser, playJoker, revealedPartner,
  partnerIndices,
  scoreOf: compatibilityScore,
  desirabiliteOf: (p) => (Number.isFinite(p?.desirabilite) ? p.desirabilite : 0.5),
};
