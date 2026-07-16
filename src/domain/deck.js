'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine DECK — l'ordre de la pile de découverte, en code PUR (zéro I/O).
// Le Super Like traverse le paywall PAR LE DECK (doctrine, 15/07) : la carte de
// qui m'a super-likée remonte en tête, marquée `superLikedMe`, même gratuite.
// Le Priority Like (avantage Prestige) la suit : un signal DIRIGÉ vers moi prime
// sur un Boost, qui n'est qu'une mise en avant générique achetée.
// ─────────────────────────────────────────────────────────────────────────────

/** 1 si les intentions sont complémentaires (envol ↔ retour), 0 sinon. */
function complementScore(mine, theirs) {
  if (!mine || !theirs || mine === 'any' || theirs === 'any') return 0;
  return mine !== theirs ? 1 : 0;
}

/**
 * Marque et ordonne la pile. Retourne une NOUVELLE liste (la source reste
 * intacte) ; chaque carte reçoit `superLikedMe` et `priorityLikedMe`. Tri
 * stable, priorités :
 *   ① super-like reçu  ② Priority Like (Prestige)  ③ boosté
 *   ④ intention complémentaire  ⑤ ordre d'entrée.
 */
function orderDeck(cards, {
  superLikerIds = new Set(), priorityLikerIds = new Set(),
  boostedIds = new Set(), myIntention = null,
} = {}) {
  const marked = cards.map((c) => ({
    ...c,
    superLikedMe: superLikerIds.has(c.id),
    priorityLikedMe: priorityLikerIds.has(c.id),
  }));
  // Tri stable garanti : on décore avec l'index d'entrée et on départage dessus.
  return marked
    .map((c, i) => ({ c, i }))
    .sort((A, B) => {
      const a = A.c; const b = B.c;
      const sa = a.superLikedMe ? 1 : 0;
      const sb = b.superLikedMe ? 1 : 0;
      if (sa !== sb) return sb - sa;
      const pa = a.priorityLikedMe ? 1 : 0;
      const pb = b.priorityLikedMe ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ba = boostedIds.has(a.id) ? 1 : 0;
      const bb = boostedIds.has(b.id) ? 1 : 0;
      if (ba !== bb) return bb - ba;
      const ca = complementScore(myIntention, a.intention);
      const cb = complementScore(myIntention, b.intention);
      if (ca !== cb) return cb - ca;
      return A.i - B.i; // ordre d'entrée conservé
    })
    .map((x) => x.c);
}

module.exports = { orderDeck, complementScore };
