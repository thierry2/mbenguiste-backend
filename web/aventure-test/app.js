'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Joueur d'Aventure — 2ᵉ compte, page de TEST (pas de mock : vrai backend).
//
// Elle parle au MÊME backend que l'app (même origine → aucun souci CORS/CSP) et
// s'authentifie sur Supabase (auth REST, pas de SDK). Modèle SIMPLE : on POLL la
// session pour connaître le nœud courant (quand le téléphone répond, le serveur
// avance, on le voit au tick suivant). Les options restent cliquables : répondre
// deux fois écrase (UPSERT côté serveur), donc une boucle de désaccord se rejoue
// juste en recliquant.
// ─────────────────────────────────────────────────────────────────────────────

const API = '/api/v1';
const $ = (id) => document.getElementById(id);

let cfg = null;          // { supabaseUrl, supabaseAnonKey }
let token = null;        // access_token Supabase
let session = null;      // { sessionId, role, graphId, startNode }
let graph = null;        // { nodes, start, ... }
let currentNode = null;  // id du nœud affiché
let poll = null;

function setMsg(el, text, cls) { el.textContent = text || ''; el.className = 'msg' + (cls ? ' ' + cls : ''); }

async function loadConfig() {
  const r = await fetch('/aventure-test/config.json');
  cfg = await r.json();
}

// ── Auth Supabase (mot de passe) ─────────────────────────────────────────────
async function signIn(email, password) {
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || d.msg || 'Connexion refusée');
  return d.access_token;
}

// ── Appels backend (toujours authentifiés) ───────────────────────────────────
async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || ('Erreur ' + r.status)); e.status = r.status; e.data = d; throw e; }
  return d.data;
}

// ── Démarrage : session (le serveur TIRE le graphe au sort) + graphe ─────────
async function start() {
  const d = await api('/discovery/mystere/start', 'POST', {});
  return d.session;
}
async function loadGraph(id) {
  const d = await api('/discovery/mystere/graph/' + encodeURIComponent(id));
  return d.graph;
}

// ── Rendu d'un nœud ──────────────────────────────────────────────────────────
function render() {
  const node = graph.nodes[currentNode];
  $('who').textContent = 'Tu es le joueur ' + (session.role === 'a' ? 'A' : 'B');
  $('state').textContent = 'nœud : ' + currentNode;
  $('ambiance').textContent = node && node.ambiance ? 'Ambiance : ' + node.ambiance : '';
  $('options').innerHTML = '';
  $('intime').classList.add('hidden');
  $('end').classList.add('hidden');
  setMsg($('game-msg'), '');

  if (!node) { $('question').textContent = '(nœud inconnu : ' + currentNode + ')'; return; }

  if (node.kind === 'end') { renderEnd(node); return; }

  $('question').textContent = node.question || '(pas de texte)';

  if (node.kind === 'intime') {
    $('intime').classList.remove('hidden');
    return;
  }
  // epreuve / consentement → boutons
  const opts = node.options || ['Option A', 'Option B'];
  opts.forEach((label, i) => {
    const b = document.createElement('button');
    b.textContent = String.fromCharCode(65 + i) + ' · ' + label;
    b.onclick = () => answer({ answerIndex: i });
    $('options').appendChild(b);
  });
}

function renderEnd(node) {
  $('question').textContent = '';
  $('options').innerHTML = '';
  $('end').classList.remove('hidden');
  const titles = { match: 'Vous vous êtes trouvés 💛', echec: 'Il ne manquait qu’une épreuve.', left: 'Vous en êtes restés là.' };
  $('end-title').textContent = titles[node.end] || ('Fin : ' + node.end);
  $('btn-joker').classList.toggle('hidden', node.end !== 'echec');
}

// ── Répondre ─────────────────────────────────────────────────────────────────
async function answer(payload) {
  try {
    setMsg($('game-msg'), 'Réponse envoyée — on attend l’autre…');
    const r = await api('/discovery/mystere/answer', 'POST', payload);
    if (r.waiting) setMsg($('game-msg'), 'En attente de l’autre joueur…');
    else if (r.issue === 'boucle') setMsg($('game-msg'), 'Désaccord — on rejoue. Reclique.');
    else setMsg($('game-msg'), 'Résolu : ' + (r.issue || '') + (r.outcome ? ' → ' + r.outcome : ''), 'ok');
    await tick(); // rafraîchit tout de suite
  } catch (e) { setMsg($('game-msg'), e.message, 'err'); }
}

$('btn-send').onclick = () => {
  const msg = $('msg').value.trim();
  if (msg) answer({ message: msg });
};
$('btn-joker').onclick = async () => {
  try { await api('/discovery/mystere/joker', 'POST', {}); setMsg($('game-msg'), 'Joker joué.', 'ok'); await tick(); }
  catch (e) { setMsg($('game-msg'), e.status === 402 ? 'Pas de Joker sur ce compte.' : e.message, 'err'); }
};
$('btn-leave').onclick = async () => {
  if (!confirm('Terminer définitivement le mystère ?')) return;
  try { await api('/discovery/mystere/leave', 'POST', {}); setMsg($('game-msg'), 'Mystère terminé.', 'ok'); stopPoll(); }
  catch (e) { setMsg($('game-msg'), e.message, 'err'); }
};
$('btn-refresh').onclick = () => tick();

// ── Poll : le nœud courant fait foi (le serveur avance quand l'autre répond) ──
async function tick() {
  try {
    const s = await start();               // idempotent : rend le nœud courant
    if (s.startNode && s.startNode !== currentNode) { currentNode = s.startNode; render(); }
    else if (graph.nodes[currentNode] && graph.nodes[currentNode].kind === 'end') { render(); stopPoll(); }
  } catch (e) { /* réseau : on retentera au prochain tick */ }
}
function startPoll() { stopPoll(); poll = setInterval(tick, 2000); }
function stopPoll() { if (poll) clearInterval(poll); poll = null; }

// ── Connexion → démarrage ────────────────────────────────────────────────────
$('btn-login').onclick = async () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  setMsg($('login-msg'), 'Connexion…');
  try {
    token = await signIn(email, password);
    session = await start();
    graph = await loadGraph(session.graphId);
    if (!graph) throw new Error('Aucun scénario en base (sauve un graphe dans /admin).');
    currentNode = session.startNode;
    $('login').classList.add('hidden');
    $('game').classList.remove('hidden');
    render();
    startPoll();
  } catch (e) {
    let m = e.message;
    if (e.status === 404) m = 'Aucun mystère pour ce compte — force d’abord une paire.';
    if (e.status === 400 && /scénario/i.test(e.message)) m = 'Aucun scénario configuré — sauve un graphe dans /admin.';
    setMsg($('login-msg'), m, 'err');
  }
};

loadConfig().catch(() => setMsg($('login-msg'), 'Config indisponible.', 'err'));
