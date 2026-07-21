'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// OÙ EN EST L'AVENTURE ? — pur, dérivé du graphe et du nœud courant.
//
// L'onglet Mystère affichait `etape: 0` EN DUR, avec le commentaire « la
// progression live vit dans le lecteur ». Sauf que le flou de la carte EST la
// jauge de progression : l'aiguille restait donc collée à zéro, et quelqu'un à
// une épreuve du but voyait le flou maximal, « Quelqu'un t'attend » et
// « Vivre l'Aventure » au lieu de « Reprendre l'Aventure ».
//
// Le client ne peut pas le calculer : hors du lecteur, il ne connaît ni la
// session ni le nœud courant. C'est donc au serveur de le dire, à partir de la
// seule source de vérité (`aventure_sessions.current_node` + le graphe joué).
//
// COMPTAGE, miroir exact du lecteur (`totalSteps`, app/aventure/[id].tsx) :
// comptent les épreuves et les intimes ; ne comptent ni les consentements (ce
// sont des portes, pas des étapes) ni les fins.
// ─────────────────────────────────────────────────────────────────────────────

/** Ce nœud compte-t-il comme une étape ? */
function compte(node) {
  return !!node && node.kind !== 'end' && node.kind !== 'consentement';
}

/** Les nœuds atteignables en un pas — toutes branches confondues. */
function successeurs(node) {
  if (!node) return [];
  const out = [];
  const acc = node.accord;
  if (acc) {
    if (acc.survie && acc.survie.next) out.push(acc.survie.next);
    if (acc.mort && acc.mort.next) out.push(acc.mort.next);
  }
  if (node.desaccord && node.desaccord.mort) out.push(node.desaccord.mort);
  if (node.next) out.push(node.next);
  if (node.oui) out.push(node.oui);
  if (node.non) out.push(node.non);
  return out;
}

/**
 * `{ etape, total }` — combien d'étapes sont DERRIÈRE nous, sur combien.
 *
 * On parcourt en largeur depuis `start` : le premier chemin qui atteint le nœud
 * courant est le plus court, et c'est celui qui décrit honnêtement le parcours
 * (un détour par un désaccord n'ajoute pas d'étape, il rejoue la même).
 *
 * Le `vus` n'est pas une optimisation : les graphes BOUCLENT (un désaccord
 * renvoie au même nœud), et sans lui le calcul ne s'arrêterait jamais.
 */
function progressionAventure(graph, currentNode) {
  const nodes = graph && graph.nodes;
  if (!nodes || typeof nodes !== 'object') return { etape: 0, total: 0 };

  const total = Object.values(nodes).filter(compte).length;
  if (!currentNode || !nodes[currentNode]) return { etape: 0, total };

  // Une fin atteinte, c'est le parcours entier : on ne rétrograde jamais
  // quelqu'un qui est allé au bout, victoire comme échec.
  if (nodes[currentNode].kind === 'end') return { etape: total, total };

  const depart = graph.start;
  if (!depart || !nodes[depart]) return { etape: 0, total };

  const file = [{ id: depart, franchies: 0 }];
  const vus = new Set([depart]);
  while (file.length) {
    const { id, franchies } = file.shift();
    if (id === currentNode) return { etape: Math.min(franchies, total), total };
    // On quitte ce nœud : s'il comptait, il passe derrière nous.
    const suivantes = franchies + (compte(nodes[id]) ? 1 : 0);
    for (const s of successeurs(nodes[id])) {
      if (nodes[s] && !vus.has(s)) { vus.add(s); file.push({ id: s, franchies: suivantes }); }
    }
  }
  // Nœud injoignable depuis le départ (graphe incohérent) : on ne dévoile rien.
  return { etape: 0, total };
}

module.exports = { progressionAventure };
