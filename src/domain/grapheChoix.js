'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// QUEL SCÉNARIO POUR CETTE PAIRE ? — pur, déterministe, sans stockage.
//
// Le graphe était tiré par `Math.random()` au moment de créer la session. Ça
// tenait tant qu'il n'y avait qu'un scénario ; au deuxième, l'onglet Mystère —
// qui précharge les clips AVANT que la session existe — n'avait aucun moyen de
// savoir lequel sortirait. Il préchargeait donc un id en dur (`grotte-ci`) et se
// serait trompé une fois sur deux : du buffering au démarrage, précisément ce
// que le préchargement existe pour supprimer.
//
// En dérivant le choix de l'ID DE LA PAIRE, deux endroits qui ne se parlent pas
// (l'onglet qui précharge, le serveur qui crée la session) arrivent au MÊME
// scénario — sans colonne supplémentaire, sans migration, sans aller-retour.
//
// Le hasard reste entier ENTRE les paires ; il devient seulement reproductible
// POUR une paire, ce qu'on veut de toute façon : un scénario ne doit pas changer
// d'un appel à l'autre.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hachage FNV-1a 32 bits — court, sans dépendance, et surtout STABLE dans le
 * temps et entre processus (contrairement à un `Math.random` ou à l'ordre
 * d'itération d'un objet). On n'a besoin d'aucune propriété cryptographique
 * ici : juste d'étaler des chaînes proches ("paire-1", "paire-2") sur des
 * valeurs éloignées, ce que FNV fait bien.
 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // Multiplication FNV en arithmétique 32 bits non signée.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Le scénario d'une paire, ou `null` si aucun n'est disponible.
 *
 * La liste est TRIÉE avant de choisir : Supabase ne garantit aucun ordre de
 * retour, et sans ce tri le même `pairId` pourrait basculer d'un scénario à
 * l'autre entre deux requêtes — ce qui ruinerait toute la propriété qu'on
 * cherche ici.
 */
function choisirGraphe(ids, cleDePaire) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const tries = [...ids].sort();
  if (tries.length === 1) return tries[0];
  // Sans clé (appel de diagnostic, admin) on rend un scénario valide plutôt
  // qu'une erreur : le premier par ordre stable.
  if (!cleDePaire) return tries[0];
  return tries[hash32(String(cleDePaire)) % tries.length];
}

module.exports = { choisirGraphe };
