'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// FILTRE DU MESSAGE INTIME — côté SERVEUR, en code PUR.
//
// La question ouverte du Mystère fait échanger un message intime, jamais des
// coordonnées : on n'échange pas de contact avant que le visage soit gagné. Le
// client filtre déjà (UX), mais le SERVEUR refiltre AVANT d'écrire en base —
// jamais faire confiance à l'entrée client (un message forgé contournerait le
// filtre front). C'est ce que promet la migration 031 : « message DÉJÀ filtré
// par le serveur ».
//
// Miroir EXACT de `frontend/src/lib/intimateFilter.ts`. Doctrine : sur-filtrer
// plutôt que laisser fuiter, MAIS ne pas massacrer un vrai message (âge, heure,
// année, compte, « snap » nom commun passent intacts). Deux garde-fous :
//   • un numéro = au moins 8 chiffres agglomérés ;
//   • un pseudo réseau n'est retiré que s'il RESSEMBLE à un handle (chiffre,
//     point ou underscore) — « instagram » sujet de phrase reste intact.
// ─────────────────────────────────────────────────────────────────────────────

const R = '•••'; // le remplacement ; ne contient ni chiffre, ni lettre, ni @ → neutre pour les passes suivantes.

const SOCIAL_KW =
  'snap|snapchat|insta|instagram|ig|whatsapp|wsp|wtsp|telegram|tg|signal|tiktok|facebook|fb|messenger';
const FILLER = "c['’]?est|cest|mon|ma|le|la|moi|add|ajoute|pseudo|est|sur|ci|:";
const DIGIT_WORD = '(?:zéro|zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf)';

/** Un pseudo « ressemble à un handle » s'il porte un chiffre, un point ou un underscore. */
function looksLikeHandle(token) {
  const t = token.toLowerCase();
  return /[a-zà-ÿ]/i.test(t) && /[0-9._]/.test(t) && t.replace(/[^a-z0-9]/gi, '').length >= 2;
}

/**
 * @returns {{ clean: string, flagged: boolean, reasons: string[] }}
 * `reasons` ⊂ { phone, email, handle, social, url }.
 */
function filtrerMessageIntime(input) {
  if (!input) return { clean: '', flagged: false, reasons: [] };

  const reasons = new Set();
  let s = input;

  // 1) URLs (avant les numéros : une URL wa.me/2376… ne doit pas se réduire à un
  //    numéro à moitié effacé — on retire le lien entier).
  s = s.replace(/\bhttps?:\/\/\S+/gi, () => { reasons.add('url'); return R; });
  s = s.replace(
    /\b(?:[a-z0-9-]+\.)*(?:wa\.me|t\.me|m\.me|fb\.me|instagram\.com|snapchat\.com|tiktok\.com|t\.co)\/?\S*/gi,
    () => { reasons.add('url'); return R; },
  );

  // 2) E-mails.
  s = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, () => { reasons.add('email'); return R; });

  // 3) Pseudos de réseau : mot-clé + (liaison)* + un token qui RESSEMBLE à un handle.
  const social = new RegExp(
    `(\\b(?:${SOCIAL_KW})\\b[\\s:=,'’.\\-]*(?:(?:${FILLER})[\\s:=,'’.\\-]*){0,3})(\\S+)`,
    'gi',
  );
  s = s.replace(social, (m, pre, tok) => {
    if (!looksLikeHandle(tok)) return m;
    reasons.add('social');
    return pre + R;
  });

  // 4) @handles.
  s = s.replace(/(^|[^a-z0-9._])@[a-z0-9._]{2,}/gi, (_m, pre) => {
    reasons.add('handle');
    return pre + R;
  });

  // 5) Numéros : suites d'au moins 8 chiffres (épargne années, heures, âges, « 100 000 »).
  s = s.replace(/\+?\d[\d\s.\-]{5,}\d/g, (m) => {
    if (m.replace(/\D/g, '').length >= 8) { reasons.add('phone'); return R; }
    return m;
  });

  // 6) Numéro ÉPELÉ en toutes lettres (7 mots-chiffres consécutifs ou plus).
  const spelled = new RegExp(`\\b${DIGIT_WORD}(?:[\\s,;.\\-]+${DIGIT_WORD}){6,}\\b`, 'gi');
  s = s.replace(spelled, () => { reasons.add('phone'); return R; });

  // Aucun vecteur → message rendu STRICTEMENT intact (pas de reformatage).
  if (reasons.size === 0) return { clean: input, flagged: false, reasons: [] };

  // Fusionne les remplacements voisins (jamais « •••••• »), normalise l'espace.
  s = s
    .replace(/•••(?:[ \t]*•••)+/g, R)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;!?…])/g, '$1')
    .trim();

  return { clean: s, flagged: true, reasons: Array.from(reasons) };
}

module.exports = { filtrerMessageIntime };
