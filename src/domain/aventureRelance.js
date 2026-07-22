'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA RELANCE DOUCE — quand une aventure s'endort.
//
// LE CAS. L'un répond, l'autre ne revient pas. Le binôme est prévenu une fois
// (« on t'attend »), et puis plus rien : notification balayée, téléphone posé,
// journée qui passe. L'aventure meurt en silence, et personne n'a rien fait de
// mal — c'est juste que rien ne l'a rappelée.
//
// LA DOCTRINE. UNE seule relance par tour, jamais deux. Ce n'est pas un système
// de rappels : c'est un filet. Si quelqu'un ignore la relance, c'est une réponse
// en soi, et insister deviendrait du harcèlement — exactement ce qui fait
// désinstaller une app de rencontre.
//
// Module PUR : il ne connaît ni base ni push. On lui donne l'état, il dit qui
// relancer. C'est ce qui rend les règles vérifiables au cas près.
// ─────────────────────────────────────────────────────────────────────────────

/** Le silence toléré avant de rappeler. Assez long pour ne pas talonner. */
const RELANCE_APRES_MS = 3 * 60 * 60 * 1000; // 3 h

/**
 * Qui relancer, à partir des attentes en cours.
 *
 * @param lignes  [{ sessionId, pairId, role, repondUAt }] — UNE ligne par
 *   réponse déjà posée sur le nœud courant (jointure faite par l'appelant).
 * @param maintenant  horodatage (ms)
 * @param apresMs     silence toléré
 * @returns [{ sessionId, pairId, roleQuiAttend, roleARelancer }]
 */
function sessionsARelancer({ lignes, maintenant, apresMs = RELANCE_APRES_MS }) {
  if (!Array.isArray(lignes)) return [];

  // Regrouper par session : c'est le NOMBRE de réponses qui décide.
  const parSession = new Map();
  for (const l of lignes) {
    if (!l || !l.sessionId || (l.role !== 'a' && l.role !== 'b')) continue;
    const g = parSession.get(l.sessionId) || { sessionId: l.sessionId, pairId: l.pairId, reponses: [] };
    g.pairId = g.pairId ?? l.pairId;
    g.reponses.push(l);
    parSession.set(l.sessionId, g);
  }

  const out = [];
  for (const g of parSession.values()) {
    // Zéro réponse : personne n'attend personne, il n'y a rien à rappeler.
    // Deux réponses : le serveur a déjà résolu (ou est sur le point de le
    // faire) — relancer annoncerait une attente qui n'existe plus.
    if (g.reponses.length !== 1) continue;

    const seule = g.reponses[0];
    const depuis = Date.parse(seule.repondUAt ?? '');
    // Horodatage illisible : on ne relance pas. Mieux vaut une relance qui
    // n'arrive pas qu'une relance envoyée sur une donnée qu'on ne comprend pas.
    if (!Number.isFinite(depuis)) continue;
    if (maintenant - depuis < apresMs) continue;

    out.push({
      sessionId: g.sessionId,
      pairId: g.pairId ?? null,
      roleQuiAttend: seule.role,
      // On relance CELUI QUI N'A PAS RÉPONDU — jamais celui qui attend, il a
      // déjà joué et n'a rien à faire de plus.
      roleARelancer: seule.role === 'a' ? 'b' : 'a',
    });
  }
  return out;
}

module.exports = { sessionsARelancer, RELANCE_APRES_MS };
