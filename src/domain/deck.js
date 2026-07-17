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

/**
 * Verrou de réciprocité photos, appliqué à la PILE (réf Tinder, spec 16/07) :
 * sans `required` photos soi-même, chaque carte ne livre que les `visible`
 * premières photos — `photosVerrouillees` + `photosTotal` disent au front de
 * rendre la slide « Débloquer les photos » à la place du reste. Le flag n'est
 * posé que s'il y a RÉELLEMENT des photos cachées (≤ visible = rien à vendre).
 * Nouvelle liste, source intacte (pure).
 */
function lockPhotos(cards, { myPhotoCount = 0, required = 2, visible = 2 } = {}) {
  const unlocked = myPhotoCount >= required;
  return cards.map((c) => {
    const total = c.photos?.length ?? 0;
    if (unlocked || total <= visible) {
      return { ...c, photosVerrouillees: false, photosTotal: total };
    }
    return {
      ...c,
      photos: (c.photos ?? []).slice(0, visible),
      photosVerrouillees: true,
      photosTotal: total,
    };
  });
}

/**
 * Réciprocité (spec 16/07) : les préférences du CANDIDAT m'acceptent-elles ?
 * Filtre DUR, symétrique du filtre genre/âge que j'applique de mon côté —
 * sans lui, on sert des profils qui ne me verront jamais (like à fonds perdus).
 * Doctrine de tolérance : l'INCONNU laisse passer (pas de ligne de préférences,
 * borne absente, mon genre/âge non renseigné) — on ne filtre que sur du certain.
 */
function acceptsMe(candPrefs, { myGenderId, myAge } = {}) {
  if (!candPrefs) return true;
  if (candPrefs.seeking_gender_id && myGenderId && candPrefs.seeking_gender_id !== myGenderId) {
    return false;
  }
  if (myAge != null) {
    if (candPrefs.min_age != null && myAge < candPrefs.min_age) return false;
    if (candPrefs.max_age != null && myAge > candPrefs.max_age) return false;
  }
  return true;
}

module.exports = { orderDeck, lockPhotos, acceptsMe };
