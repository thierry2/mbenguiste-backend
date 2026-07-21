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
const { resoudreEtape, doitInjecterIntime } = require('../domain/aventure');

/**
 * PRÉVENIR CELUI QU'ON ATTEND. C'est un jeu à deux en asynchrone : entre deux
 * étapes, l'un attend l'autre — parfois des heures. Sans ce push, la seule façon
 * de savoir que son binôme a joué était d'ouvrir l'onglet au hasard, et
 * l'aventure mourait d'attente (audit 21/07 : le service n'envoyait RIEN).
 *
 * On ne notifie QUE sur une résolution : tant que j'attends, l'autre n'a rien de
 * neuf à voir — il a déjà été prévenu à l'étape précédente, le re-notifier
 * serait du bruit. Et jamais celui qui vient de jouer : il est devant l'écran.
 *
 * BEST-EFFORT ABSOLU : un service de push indisponible ne doit pas bloquer une
 * partie. Toute erreur est avalée ici, jamais remontée à l'appelant.
 */
async function prevenirPartenaire({ notifier, membresDePaire }, { pairId, userId, type }) {
  if (!notifier || !membresDePaire) return;
  try {
    const membres = await membresDePaire(pairId);
    if (!Array.isArray(membres)) return;
    const partenaire = membres.find((m) => m && m !== userId);
    if (!partenaire) return;
    await notifier(partenaire, type);
  } catch (e) {
    console.error('[aventure] notification de tour:', e && e.message);
  }
}

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
  //
  // CERVEAU UNIQUE (034) : `negocier` et `clipAJouer` sont désormais calculés ICI
  // et ÉCRITS dans la session — les DEUX clients les LISENT (Realtime), aucun ne
  // les recalcule plus sur son propre `toursDesaccord` local. Avant ça, un
  // message Realtime manqué désynchronisait les deux compteurs locaux : l'un
  // voyait la question intime, l'autre non (cf. docs/audit-mystere.md §1).
  if (r.issue === 'boucle') {
    const negocier = doitInjecterIntime(r.tour, node.desaccord && node.desaccord.maxTours);
    const clipAJouer = (node.desaccord && node.desaccord.clip) || null;
    await advanceSession(sessionId, {
      currentNode: session.currentNode, toursDesaccord: r.tour, clearAnswers: true,
      lastIssue: 'boucle', negocier, clipAJouer,
    });
    // La question se rejoue : on attend de nouveau l'autre → on le prévient.
    await prevenirPartenaire(deps, { pairId: session.pairId, userId, type: 'mystere_turn' });
    return { resolved: true, issue: 'boucle', role, negocier, clipAJouer, tour: r.tour };
  }

  const nextNode = r.next;
  const cible = nextNode ? graph.nodes[nextNode] : null;
  const outcome = cible && cible.kind === 'end' ? cible.end : null; // match|echec|left|null
  const clipAJouer = r.clip || null; // clip de conséquence (succès/mort), si le graphe en prévoit un

  await advanceSession(sessionId, {
    currentNode: nextNode, toursDesaccord: 0, outcome, clearAnswers: true,
    lastIssue: r.issue, negocier: false, clipAJouer,
  });

  // La victoire crée le match ; la sortie propre clôt sans match. L'ÉCHEC laisse
  // la paire active — le Joker doit pouvoir rejouer la dernière épreuve.
  if (outcome === 'match') await clore(session.pairId, 'match');
  else if (outcome === 'left') await clore(session.pairId, 'left');

  // Chaque fin porte son propre message. L'ÉCHEC, lui, n'est pas une fin : la
  // paire vit encore (le Joker peut rejouer) → on attend toujours l'autre.
  const type = outcome === 'match' ? 'mystere_reveal'
    : outcome === 'left' ? 'mystere_ended'
    : 'mystere_turn';
  await prevenirPartenaire(deps, { pairId: session.pairId, userId, type });

  return {
    resolved: true, issue: r.issue, next: nextNode, outcome, role,
    reveal: r.reveal, clipAJouer, negocier: false,
  };
}

/** Câblage réel : assemble le modèle Supabase et soumet une réponse. */
async function soumettre({ sessionId, userId, answerIndex, message }) {
  const model = require('../models/mystere.model');
  // Graphe depuis la BD (éditable /admin), repli sur le code si la table est vide.
  const { grapheRuntime } = require('../models/graphs.model');
  const notif = require('./notification.service');
  // Un seul aiguillage type → push, pour que le service de résolution n'ait
  // jamais à connaître la forme d'une notification.
  const notifier = (uid, type) => {
    if (type === 'mystere_turn') return notif.onMystereTurn(uid);
    if (type === 'mystere_reveal') return notif.onMystereReveal(uid);
    if (type === 'mystere_ended') return notif.onMystereEnded(uid);
    return Promise.resolve();
  };
  return soumettreReponse(
    { ...model, graphe: grapheRuntime, clore: model.revealAndMatch, notifier },
    { sessionId, userId, answerIndex, message },
  );
}

module.exports = { soumettreReponse, soumettre };
