'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine DECK — l'ordre de la pile de découverte, en code PUR (zéro I/O).
// Le Super Like traverse le paywall PAR LE DECK (doctrine, 15/07) : la carte de
// qui m'a super-likée remonte en tête, marquée `superLikedMe`, même gratuite.
// Le Priority Like (avantage Prestige) la suit : un signal DIRIGÉ vers moi prime
// sur un Boost, qui n'est qu'une mise en avant générique achetée.
// Sous ces trois rangs — des promesses produit VENDUES, qu'aucun score ne
// dépasse ni ne dilue — c'est le score de pertinence (domaine ranking) qui
// ordonne. Sans scores : ordre d'entrée (dégradation douce).
// L'intention/route a quitté le tri le 16/07 (concept abandonné le 14/07).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marque et ordonne la pile. Retourne une NOUVELLE liste (la source reste
 * intacte) ; chaque carte reçoit `superLikedMe` et `priorityLikedMe`. Tri
 * stable, priorités :
 *   ① super-like reçu  ② Priority Like (Prestige)  ③ boosté
 *   ④ score de pertinence (Map id→score, domaine ranking)  ⑤ ordre d'entrée.
 */
function orderDeck(cards, {
  superLikerIds = new Set(), priorityLikerIds = new Set(),
  boostedIds = new Set(), scores = new Map(),
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
      const ra = scores.get(a.id) ?? 0;
      const rb = scores.get(b.id) ?? 0;
      if (ra !== rb) return rb - ra;
      return A.i - B.i; // ordre d'entrée conservé
    })
    .map((x) => x.c);
}

module.exports = { orderDeck };
