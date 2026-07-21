'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA CONVERSATION A-T-ELLE COMMENCÉ ? Pur, donc identique pour tout le monde.
//
// POURQUOI ÇA VIT ICI. La règle « aux premiers messages ENTRE LES DEUX »
// décide quand la carte de révélation du Mystère s'efface. Elle était écrite
// côté client, dans `aventureRevelation.ts`, mais alimentée par un simple tap
// local : chaque téléphone concluait dans son coin. D'où le bug du 21/07 — le
// mystère effacé sur un téléphone, toujours affiché sur l'autre.
//
// La seule chose que deux téléphones ont en commun, c'est le serveur. La règle
// remonte donc ici, et les deux clients LISENT le même verdict — même doctrine
// que le cerveau unique de l'Aventure.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Vrai si MOI et au moins UN AUTRE avons écrit dans ce fil.
 *
 * Un message parti sans réponse ne compte pas : s'il ne s'est rien passé, la
 * révélation reste — elle n'a pas encore joué son rôle. On préfère laisser une
 * carte de trop que d'effacer un moment que personne n'a vécu.
 */
function conversationDemarree(expediteurs, userId) {
  if (!Array.isArray(expediteurs) || !userId) return false;
  let moi = false;
  let autre = false;
  for (const id of expediteurs) {
    if (!id) continue;              // valeur vide : pas un interlocuteur
    if (id === userId) moi = true;
    else autre = true;
    if (moi && autre) return true;  // inutile d'aller plus loin
  }
  return false;
}

module.exports = { conversationDemarree };
