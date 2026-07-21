'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION D'AVENTURE — le CERVEAU serveur, en code PUR (zéro I/O).
//
// Le serveur est autoritaire (décision 20/07) : à partir des DEUX réponses, il
// dit où va l'aventure. Chaque client ne fait qu'envoyer sa réponse et rendre ce
// que le serveur décide — impossible que deux téléphones se contredisent.
//
// DÉTERMINISTE, sans hasard. La politique produit remplace la proba :
//   · toute épreuve d'accord RÉUSSIT… SAUF la dernière (celle qui dévoile le
//     visage) tant que le Joker n'a pas été joué → elle échoue, « il ne manque
//     que la photo », ce qui pousse au Joker (qui, lui, révèle pour LES DEUX) ;
//   · désaccord → on REJOUE le nœud (boucle), jusqu'au plafond de tours = mort ;
//   · consentement → unanimité (« on continue » des deux) ou sortie propre ;
//   · intime → suite générique.
//
// Miroir du moteur front (`adventureEngine.ts`) — mais réduit au ROUTAGE : ni
// proba, ni rng, ni clip. C'est ce que « échec forcé » permet.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DESACCORDS = 6;

/** Deux réponses (0/1) → la clé de combinaison. */
function comboKey(a, b) {
  if (a === b) return a === 0 ? 'AA' : 'BB';
  return 'AB';
}

/** L'épreuve dont la réussite mène DIRECTEMENT à la révélation (fin 'match'). */
function estEpreuveFinale(graph, nodeId) {
  const node = graph.nodes[nodeId];
  if (!node || node.kind !== 'epreuve') return false;
  const dest = node.accord && node.accord.survie && node.accord.survie.next;
  const cible = dest ? graph.nodes[dest] : null;
  return !!cible && cible.kind === 'end' && cible.end === 'match';
}

/** Est-ce l'épreuve finale, d'après son routage (utilisé par la politique). */
function nodeEstFinale(node, graph) {
  const dest = node.accord && node.accord.survie && node.accord.survie.next;
  const cible = dest ? graph.nodes[dest] : null;
  return !!cible && cible.kind === 'end' && cible.end === 'match';
}

/**
 * Résout UNE étape. `answers` = { a, b } (indices 0/1 pour un choix ; null/null
 * pour un intime). `ctx` = { jokerUsed, toursDesaccord }.
 *
 * Renvoie { issue, next, reveal?, tour? } — `issue` ∈ survie|mort|boucle (les
 * intimes et consentements-oui valent 'survie' = « on avance »).
 */
function resoudreEtape(graph, node, answers, ctx = {}) {
  const { jokerUsed = false, toursDesaccord = 0 } = ctx;

  if (node.kind === 'intime') {
    // La suite ne dépend pas du message : générique. L'aveu se gagne ici.
    return { issue: 'survie', next: node.next || null, reveal: node.reveal };
  }

  if (node.kind === 'consentement') {
    // Unanimité : il faut « on continue » (0) des DEUX. Sinon sortie propre.
    const onContinue = answers.a === 0 && answers.b === 0;
    return { issue: onContinue ? 'survie' : 'mort', next: onContinue ? node.oui : node.non };
  }

  // ── Épreuve ──
  const combo = comboKey(answers.a, answers.b);

  if (combo === 'AB') {
    // Désaccord : on REJOUE, sauf au plafond où ça tue. Aucune proba.
    const d = node.desaccord || {};
    const tour = toursDesaccord + 1;
    if (tour >= (d.maxTours || MAX_DESACCORDS)) {
      return { issue: 'mort', next: d.mort || null };
    }
    return { issue: 'boucle', next: null, tour };
  }

  // Accord (AA ou BB, même issue).
  const survie = survitAccord(node, graph, { jokerUsed, rng: ctx.rng });
  const acc = node.accord || {};
  const branche = survie ? acc.survie : acc.mort;
  return {
    issue: survie ? 'survie' : 'mort',
    next: (branche && branche.next) || null,
    clip: (branche && branche.clip) || undefined,
    // L'indice est une récompense : jamais sur une mort.
    reveal: survie ? node.reveal : undefined,
  };
}

/**
 * L'accord survit-il ? — DÉTERMINISTE, configurable PAR LE GRAPHE (jamais figé
 * dans le code, cahier des charges 21/07).
 *
 *   · Le Joker GARANTIT la révélation : sur l'épreuve finale, une fois joué, on
 *     survit toujours, quoi que dise le graphe.
 *   · Sinon, `node.accord.proba` pilote l'issue : le graphe peut mettre 1 partout
 *     et 0 sur la finale (« il ne manque que le visage »), puis remonter la
 *     finale à 1 une fois qu'on veut que l'aventure se termine plus facilement —
 *     sans toucher une ligne de code.
 *   · Graphe legacy sans `proba` (ex. les graphes de test créés avant le 21/07) :
 *     on retombe sur l'ancienne politique en dur (tout réussit sauf la finale
 *     sans Joker), pour ne rien casser de ce qui tournait déjà.
 *   · `rng` est injectable (`ctx.rng`, défaut déterministe `() => 0`) : le jour
 *     où une vraie probabilité est voulue, on remplace juste ce tirage — rien
 *     d'autre ne change (même levier que côté client, `adventureEngine.ts`).
 */
function survitAccord(node, graph, { jokerUsed = false, rng } = {}) {
  const finale = nodeEstFinale(node, graph);
  if (finale && jokerUsed) return true;
  const acc = node.accord || {};
  const proba = Number.isFinite(acc.proba) ? acc.proba : (finale ? 0 : 1);
  const tirage = typeof rng === 'function' ? rng : () => 0;
  return tirage() < proba;
}

/**
 * Faut-il glisser un MOMENT INTIME dans une boucle de désaccord ? — miroir EXACT
 * de `adventureEngine.ts` (front). Deux désaccords d'affilée deviennent
 * mécaniques ; on casse la boucle par une question intime, une fois sur deux.
 * ⚠ Ce n'est PAS une étape : elle ne débloque aucun indice.
 *
 * Calculée ICI (serveur) et non plus par chaque client sur son PROPRE compteur :
 * c'est ce qui garantissait auparavant qu'un message Realtime manqué désaccorde
 * les deux `tours_desaccord` locaux, et donc la décision « négociation ou pas »
 * (un joueur voit la question intime, l'autre non). Servie par la session, elle
 * est désormais identique pour les deux.
 */
function doitInjecterIntime(tour, maxTours = MAX_DESACCORDS) {
  return tour > 0 && tour % 2 === 0 && tour < maxTours;
}

/**
 * L'id de l'épreuve finale d'un graphe (celle dont la réussite mène à 'match').
 * C'est là que le Joker renvoie : on rejoue la dernière épreuve, qui réussit
 * cette fois (`jokerUsed`). Renvoie null si le graphe n'en a pas.
 */
function trouveEpreuveFinale(graph) {
  if (!graph || !graph.nodes) return null;
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (node.kind === 'epreuve' && nodeEstFinale(node, graph)) return id;
  }
  return null;
}

/**
 * Valide un graphe édité (console admin) AVANT de l'enregistrer : un graphe cassé
 * bloquerait des aventures en cours. Renvoie la liste des problèmes (vide = OK).
 * On vérifie l'essentiel du ROUTAGE : start présent, et toute cible référencée
 * existe (une flèche vers un nœud inexistant = aventure figée).
 */
function validerGraphe(g) {
  if (!g || typeof g !== 'object') return ['graphe vide'];
  if (!g.nodes || typeof g.nodes !== 'object') return ['aucun nœud'];
  const problems = [];
  const ids = new Set(Object.keys(g.nodes));
  if (!g.start || !ids.has(g.start)) problems.push(`start « ${g.start} » absent des nœuds`);

  for (const [id, node] of Object.entries(g.nodes)) {
    const cibles = [];
    if (node.next) cibles.push(node.next);
    if (node.oui) cibles.push(node.oui);
    if (node.non) cibles.push(node.non);
    if (node.accord && node.accord.survie && node.accord.survie.next) cibles.push(node.accord.survie.next);
    if (node.accord && node.accord.mort && node.accord.mort.next) cibles.push(node.accord.mort.next);
    if (node.desaccord && node.desaccord.mort) cibles.push(node.desaccord.mort);
    for (const t of cibles) {
      if (!ids.has(t)) problems.push(`« ${id} » pointe vers « ${t} » qui n'existe pas`);
    }
  }
  return problems;
}

module.exports = {
  comboKey, estEpreuveFinale, trouveEpreuveFinale, resoudreEtape, validerGraphe,
  doitInjecterIntime, survitAccord, MAX_DESACCORDS,
};
