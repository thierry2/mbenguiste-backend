'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine ACCÈS — la doctrine des offres (docs/doctrine-offres.md) en code PUR
// (zéro I/O, zéro dépendance). Tout ce qui décide « qui a droit à quoi » vit
// ici et nulle part ailleurs ; les services ne font que brancher la base.
//
// Vocabulaire :
//  - tier   : 'free' | 'plus' | 'or' | 'prestige' (étiquettes de VENTE) ;
//  - offert : palier accordé sans paiement (gratuité femmes au lancement).
//    Invariant n°5 : la révélation ne s'offre jamais — un palier offert perd
//    grilleDefloutee et picksIllimites, et UNIQUEMENT eux.
//  - capacités : les droits RÉELS. Le front et les gardes serveur ne regardent
//    QUE les capacités, jamais un nom de palier (doctrine §3).
// ─────────────────────────────────────────────────────────────────────────────

const TIERS = ['free', 'plus', 'or', 'prestige'];
const RANK = new Map(TIERS.map((t, i) => [t, i]));

/** `tier` vaut-il au moins `min` dans l'échelle des paliers ? */
function atLeast(tier, min) {
  return (RANK.get(tier) ?? 0) >= (RANK.get(min) ?? Infinity);
}

/**
 * Résout le palier effectif d'un utilisateur.
 *  1. Un abonnement payé ACTIF (tier connu + échéance non passée) gagne toujours ;
 *  2. sinon, femme + flag gratuité → Or offert ;
 *  3. sinon free.
 * `premiumUntil` passé = expiré même si le webhook n'a pas encore nettoyé
 * (garde-fou) ; null = pas d'échéance connue, le tier posé fait foi.
 */
function resolveTier({ premiumTier, premiumUntil, genderCode, freeTierWomen, now = Date.now() }) {
  const paidValid =
    premiumTier != null &&
    RANK.has(premiumTier) && premiumTier !== 'free' &&
    (!premiumUntil || new Date(premiumUntil).getTime() > now);
  if (paidValid) return { tier: premiumTier, offert: false };

  if (freeTierWomen && genderCode === 'woman') return { tier: 'or', offert: true };

  return { tier: 'free', offert: false };
}

/**
 * La matrice des droits — chaque palier inclut le précédent.
 * `offert` retire exactement la révélation (invariant n°5), rien d'autre.
 */
function capabilitiesFor(tier, offert = false) {
  const plus = atLeast(tier, 'plus');
  const or = atLeast(tier, 'or');
  const prestige = atLeast(tier, 'prestige');
  return {
    // Plus — le confort de mon côté de l'écran.
    likesIllimites: plus,
    peutRewind: plus,
    peutIncognito: plus,
    // Or — voir qui t'aime, affiner, comprendre.
    filtresAvances: or,
    traductionIllimitee: or,
    grilleDefloutee: or && !offert,   // la révélation ne s'offre jamais
    picksIllimites: or && !offert,    // liker depuis la sélection reste vendu
    // Prestige — passer devant.
    priorityLikes: prestige,
    motAvantMatch: prestige,
  };
}

/**
 * Les avantages récurrents dus à un palier (crédités paresseusement par
 * grants.service, une fois par période). L'offert reçoit les munitions de
 * l'Or : la doctrine offre l'ACCÈS et les munitions, jamais la révélation.
 */
function grantsDue(tier, offert = false) {
  const due = [];
  if (atLeast(tier, 'or')) {
    due.push({ kind: 'superlike', quantity: 5, period: 'week' });
    due.push({ kind: 'boost', quantity: 1, period: 'month' });
  }
  if (atLeast(tier, 'prestige') && !offert) {
    due.push({ kind: 'joker', quantity: 1, period: 'week' });
  }
  return due;
}

/**
 * Clé de période STABLE (UTC) pour le registre anti double-versement :
 *  - month : '2026-07' ;
 *  - week  : semaine ISO 8601 ('2026-W29') — lundi = début, la semaine 1 est
 *    celle qui contient le premier jeudi de l'année (bords d'année corrects).
 */
function periodKey(period, now = Date.now()) {
  const d = new Date(now);
  if (period === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (period === 'week') {
    // Algorithme ISO : on se déplace au jeudi de la semaine courante ; l'année
    // de ce jeudi est l'année ISO, et son rang de semaine se déduit du 1er janvier.
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;              // lundi=1 … dimanche=7
    t.setUTCDate(t.getUTCDate() + 4 - day);      // → le jeudi de la semaine
    const isoYear = t.getUTCFullYear();
    const yearStart = Date.UTC(isoYear, 0, 1);
    const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
  }
  throw new Error(`Période inconnue : ${period}`);
}

module.exports = { TIERS, atLeast, resolveTier, capabilitiesFor, grantsDue, periodKey };
