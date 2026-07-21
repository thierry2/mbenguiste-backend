'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA MACHINE À ÉTATS DE L'AVENTURE — SERVEUR AUTORITAIRE (034).
//
// Miroir EXACT de frontend/src/lib/aventureMachine.ts. Avant le 21/07, cette
// machine ne vivait QUE côté client, et chaque téléphone en tenait sa PROPRE
// instance : deux vérités qui ne se réconcilient jamais dès qu'un message
// Realtime est manqué (intime vue par un seul, Joker qui bloque l'autre). Le
// serveur est maintenant la SEULE instance qui tranche ; les deux clients ne
// font plus que LIRE la session qui en résulte (`aventure.service`).
//
// Toute divergence entre ce fichier et son miroir front est un bug : les tests
// des deux côtés sont volontairement les mêmes scénarios.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'scene'|'choix'|'attente'|'absent'|'resolution'|'consequence'|
 *   'recompense'|'reprise'|'negociation'|'suivant'|'fin'} Phase
 * @typedef {{type: 'clipFini'|'jeReponds'|'ilRepond'|'delaiEcoule'|'resolu'|
 *   'beatFini'|'repriseFinie'|'negociationFinie'|'relance'}} Evenement
 * @typedef {{
 *   kind: 'epreuve'|'intime'|'consentement'|'end',
 *   aClip: boolean,
 *   aUnIndice?: boolean,
 *   issue?: 'survie'|'mort'|'boucle',
 *   doitNegocier?: boolean,
 *   aUnClipConsequence?: boolean,
 * }} Contexte
 */

/** Par où l'on entre dans un nœud. */
function PHASE_INITIALE(ctx) {
  if (ctx.kind === 'end') return 'fin';
  return ctx.aClip ? 'scene' : 'choix';
}

/**
 * La table de transitions. Tout ce qui n'est pas explicitement prévu laisse la
 * phase INCHANGÉE — un événement hors contexte ne peut jamais faire dérailler
 * l'aventure.
 */
function transition(phase, ev, ctx) {
  switch (phase) {
    case 'scene':
      return ev.type === 'clipFini' ? 'choix' : 'scene';

    case 'choix':
      return ev.type === 'jeReponds' ? 'attente' : 'choix';

    case 'attente':
      if (ev.type === 'ilRepond') return 'resolution';
      if (ev.type === 'delaiEcoule') return 'absent';
      return 'attente';

    case 'absent':
      if (ev.type === 'ilRepond') return 'resolution';
      if (ev.type === 'relance') return 'attente';
      return 'absent';

    case 'resolution': {
      if (ev.type !== 'resolu') return 'resolution';
      if (ctx.issue === 'boucle') return ctx.doitNegocier ? 'negociation' : 'reprise';
      return ctx.aUnClipConsequence ? 'consequence' : issueApres(ctx);
    }

    case 'consequence':
      return ev.type === 'clipFini' ? issueApres(ctx) : 'consequence';

    case 'recompense':
      return ev.type === 'beatFini' ? 'suivant' : 'recompense';

    case 'reprise':
      return ev.type === 'repriseFinie' ? 'choix' : 'reprise';

    case 'negociation':
      return ev.type === 'negociationFinie' ? 'choix' : 'negociation';

    case 'suivant':
    case 'fin':
    default:
      return phase;
  }
}

/** Où l'on atterrit une fois le clip d'issue joué (ou tout de suite, s'il n'y en a pas). */
function issueApres(ctx) {
  if (ctx.issue === 'mort') return 'fin';
  return ctx.aUnIndice ? 'recompense' : 'suivant';
}

/** Une phase où l'utilisateur peut agir (répondre / écrire). */
function peutRepondre(phase) {
  return phase === 'choix' || phase === 'attente' || phase === 'absent' || phase === 'negociation';
}

/** Une phase où le clip doit jouer. */
function clipActif(phase) {
  return phase === 'scene' || phase === 'reprise' || phase === 'consequence';
}

module.exports = { PHASE_INITIALE, transition, peutRepondre, clipActif };
