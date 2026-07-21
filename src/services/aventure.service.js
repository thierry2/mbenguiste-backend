'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SERVICE D'AVENTURE — la résolution SERVEUR AUTORITAIRE (I/O injecté → testable).
//
// Une réponse arrive → on l'enregistre. Tant que l'autre n'a pas répondu : on
// attend. Quand les DEUX ont répondu, le serveur tranche (domaine `aventure`) et
// fait avancer la session ; c'est ce nouvel état que les deux clients reçoivent
// via Realtime (abonnement à la ligne de session). Aucun client ne décide —
// impossible que deux téléphones se contredisent.
//
// L'ÉCHEC n'est pas terminal : `fin_mort` affiche l'écran d'échec avec le Joker,
// et la paire reste ACTIVE pour que le Joker rejoue la dernière épreuve. Seuls
// la victoire ('match') et la sortie propre ('left') closent la paire.
// ─────────────────────────────────────────────────────────────────────────────
const { resoudreEtape } = require('../domain/aventure');

async function soumettreReponse(deps, { sessionId, userId, answerIndex = null, message = null }) {
  const {
    getSession, roleOf, recordAnswer, answersForNode, graphe, advanceSession, clore,
  } = deps;

  const session = await getSession(sessionId);
  if (!session) return { error: 'no-session' };

  const role = await roleOf(session.pairId, userId);
  if (!role) return { error: 'not-member' };

  await recordAnswer({ sessionId, nodeId: session.currentNode, role, answerIndex, message });

  const rep = await answersForNode(sessionId, session.currentNode);
  if (!rep.aRepondu || !rep.bRepondu) return { waiting: true, role };

  // ── Les deux ont répondu → le serveur tranche. ──
  const graph = graphe(session.graphId);
  const node = graph.nodes[session.currentNode];
  const r = resoudreEtape(graph, node, { a: rep.a, b: rep.b }, {
    jokerUsed: session.jokerUsed, toursDesaccord: session.toursDesaccord,
  });

  // Désaccord : on reste sur le nœud, on rejoue (tour incrémenté), on efface les
  // réponses pour repartir sur la même question.
  if (r.issue === 'boucle') {
    await advanceSession(sessionId, {
      currentNode: session.currentNode, toursDesaccord: r.tour, clearAnswers: true,
    });
    return { resolved: true, issue: 'boucle', role };
  }

  const nextNode = r.next;
  const cible = nextNode ? graph.nodes[nextNode] : null;
  const outcome = cible && cible.kind === 'end' ? cible.end : null; // match|echec|left|null

  await advanceSession(sessionId, {
    currentNode: nextNode, toursDesaccord: 0, outcome, clearAnswers: true,
  });

  // La victoire crée le match ; la sortie propre clôt sans match. L'ÉCHEC laisse
  // la paire active — le Joker doit pouvoir rejouer la dernière épreuve.
  if (outcome === 'match') await clore(session.pairId, 'match');
  else if (outcome === 'left') await clore(session.pairId, 'left');

  return { resolved: true, issue: r.issue, next: nextNode, outcome, role };
}

/** Câblage réel : assemble le modèle Supabase et soumet une réponse. */
async function soumettre({ sessionId, userId, answerIndex, message }) {
  const model = require('../models/mystere.model');
  // Graphe depuis la BD (éditable /admin), repli sur le code si la table est vide.
  const { grapheRuntime } = require('../models/graphs.model');
  return soumettreReponse(
    { ...model, graphe: grapheRuntime, clore: model.revealAndMatch },
    { sessionId, userId, answerIndex, message },
  );
}

module.exports = { soumettreReponse, soumettre };
