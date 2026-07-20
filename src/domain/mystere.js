'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine MYSTÈRE — l'attribution, en code PUR (zéro I/O).
//
// Conception arrêtée le 18/07, reprise ici telle quelle :
//
//   · Appariement MUTUEL et ALGORITHMIQUE. Les deux membres d'une paire voient
//     l'autre comme leur mystère. AUCUN like n'entre en jeu — ni reçu, ni
//     réciproque : c'est de la curation, pas un signal d'intérêt.
//   · UN SEUL mystère par personne. Le pluriel a été exploré puis écarté :
//     l'attachement se divise et le Joker perd son ressort.
//   · PLANCHER de compatibilité. En dessous : AUCUN mystère, et on l'assume à
//     l'écran. On ne sert jamais quelqu'un de médiocre parce qu'il est en ligne.
//   · Trois couches à ne pas mélanger : filtres durs (en SQL, pas ici) →
//     plancher → classement. La disponibilité DÉPARTAGE les ex æquo ; elle ne
//     fait jamais monter personne au-dessus du plancher, et n'est JAMAIS un
//     filtre dur (ça réduirait le vivier aux quelques connectés).
//   · La PROPOSITION est dynamique et substituable tant que l'aventure n'a pas
//     commencé ; l'AVENTURE, elle, est verrouillée et jamais substituée.
//
// POURQUOI UN RENDEZ-VOUS. La qualité d'appariement dépend de la taille du
// vivier À L'INSTANT où l'on apparie. Apparier en continu, c'est piocher parmi
// les quelques présents à la seconde — le plancher n'est presque jamais franchi
// et la tentation est alors de le baisser. Un moment convenu fait arriver tout
// le monde ensemble : vivier maximal, plancher tenable. Le rendez-vous n'est pas
// qu'un outil de rétention, c'est CE QUI REND LE PLANCHER POSSIBLE.
//
// ⚠ L'INSTANT EST ABSOLU, jamais local. Minuit local fragmenterait le vivier par
// fuseau (Paris et Dakar jamais dans la même passe) — l'exact contraire du but,
// et ça casserait l'appariement transfrontalier qui est la signature du produit.
//
// ⚠ AUCUN HORODATAGE NE DOIT SORTIR D'ICI. Le mystère est déjà un petit ensemble
// (filtres + plancher) ; une empreinte temporelle le réduirait à une personne —
// il suffirait de croiser les « En ligne » de Découvrir avec les allées et
// venues du mystère. On expose une POSSIBILITÉ (le bouton), jamais un statut.
// ─────────────────────────────────────────────────────────────────────────────

// ⚠ AUCUNE FORMULE DE COMPATIBILITÉ ICI. Le cahier de similarité (§4) l'exige :
// « Un seul calcul, réutilisé par deck / Mystère / picks », dans `ranking.js`.
// Une première version de ce fichier recopiait la formule de `picks.js` — la
// duplication exacte qui a déjà produit deux bugs (MOCK_FRAGMENTS, les deux
// échelles d'indices). Le score est donc INJECTÉ et n'a pas de valeur par
// défaut : impossible d'en faire pousser un second par inadvertance.

/**
 * ⚙️ LES BOUTONS À TOURNER — réglables SANS REDÉPLOIEMENT (exigence du cahier).
 *
 * `heureTirageUtc` est un instant ABSOLU. Le cahier l'appelle « le rendez-vous
 * de minuit », mais l'heure elle-même n'est pas doctrinale : ce qui l'est, c'est
 * qu'il y ait UN rendez-vous, le même pour tous. Le régler revient à choisir
 * l'heure où le vivier simultané est le plus large sur l'audience réelle.
 * ⚠ Si on la déplace, la COPIE doit suivre partout (« Prochain rendez-vous à
 * minuit », « Minuit vous a réunis ») — sinon l'app ment.
 *
 * Les DEUX planchers vont dans le sens qu'on n'attend pas : hors fenêtre, le
 * vivier est mince, donc le plancher monte. Le réflexe inverse — baisser pour
 * « quand même » servir un mystère — est précisément ce que le cahier interdit.
 */
const CONFIG_DEFAUT = {
  heureTirageUtc: 21,        // instant absolu (UTC)
  fenetreMinutes: 120,       // le rendez-vous dure, il n'est pas un instant
  pasMinutes: 10,            // une passe toutes les ~10 min
  plancherFenetre: 10,       // à régler sur la vraie distribution des scores
  plancherHorsFenetre: 20,   // volontairement PLUS HAUT

  /**
   * L'APPARIEMENT ASSORTATIF, dit sans détour : les profils très désirés vont
   * ensemble, les moins désirés aussi. Ce n'est pas un jugement moral, c'est la
   * seule façon qu'un appariement IMPOSÉ 1:1 soit vivable des deux côtés — sans
   * ça, on colle à quelqu'un un partenaire qui ne le regardera pas, et les deux
   * perdent leur unique mystère du jour.
   *
   * ⚠ Ce poids est le curseur le plus SENSIBLE du système. À 0, l'appariement
   * ignore l'écart (les paires très déséquilibrées redeviennent possibles) ; trop
   * haut, il fige des castes et la découverte meurt. Réglable à chaud.
   */
  poidsEcartDesirabilite: 20,
};

/**
 * La désirabilité d'un profil — « à quel point les autres l'aiment ».
 *
 * Elle vient de `ranking.engagementScore` (taux de like reçu + dwell agrégés),
 * qui vaut NEUTRE 0.5 sous le seuil d'impressions : à froid, personne n'est
 * décrété beau ni laid. Invariant maison, et il compte doublement ici — un
 * nouveau profil ne doit pas être relégué faute de données.
 */
function desirabiliteParDefaut(profil) {
  const d = profil?.desirabilite;
  return Number.isFinite(d) ? d : 0.5;
}

/** Jitter déterministe [0,1) — FNV-1a. < 1 : ne renverse jamais un écart réel. */
function jitter(seed, cle) {
  let h = 2166136261;
  const s = `${seed}:${cle}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Clé de paire STABLE : l'ordre des deux membres ne doit rien changer. */
function clePaire(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── La fenêtre de rendez-vous ────────────────────────────────────────────────

/** Le tirage du jour de `now`, à l'heure absolue configurée. */
function tirageDuJour(now, cfg) {
  const d = new Date(now);
  return Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cfg.heureTirageUtc, 0, 0, 0,
  );
}

/**
 * Sommes-nous dans le rendez-vous ? La fenêtre DURE (elle n'est pas un instant)
 * pour tolérer les retards : quelqu'un qui ouvre l'app vingt minutes après
 * l'heure doit encore attraper la passe.
 */
function estDansLaFenetre(now, config = CONFIG_DEFAUT) {
  const cfg = { ...CONFIG_DEFAUT, ...config };
  const debut = tirageDuJour(now, cfg);
  const fin = debut + cfg.fenetreMinutes * 60_000;
  return now >= debut && now <= fin;
}

/** Le prochain rendez-vous : aujourd'hui s'il est à venir, sinon demain. */
function prochainTirage(now, config = CONFIG_DEFAUT) {
  const cfg = { ...CONFIG_DEFAUT, ...config };
  const aujourdhui = tirageDuJour(now, cfg);
  return now < aujourdhui ? aujourdhui : aujourdhui + 24 * 3600_000;
}

/** Le plancher en vigueur maintenant. Hors fenêtre, il MONTE (cf. en-tête). */
function plancherApplicable(now, config = CONFIG_DEFAUT) {
  const cfg = { ...CONFIG_DEFAUT, ...config };
  return estDansLaFenetre(now, cfg) ? cfg.plancherFenetre : cfg.plancherHorsFenetre;
}

// ── L'appariement ────────────────────────────────────────────────────────────

/**
 * Apparie le vivier en paires MUTUELLES, une par personne.
 *
 * Entrées :
 *  · `profils`    — Map id → profil (ce qui sert à scorer).
 *  · `eligibles`  — Map id → ids que les FILTRES DURS laissent passer pour lui.
 *                   Directionnel : les préférences de chacun sont les siennes.
 *  · `plancher`   — sous ce score, aucun mystère.
 *  · `verrouillees` — paires dont l'aventure a commencé : intouchables.
 *  · `score`      — injectable (tests, futurs signaux d'apprentissage).
 *
 * Algorithme : GLOUTON GLOBAL. On prend la meilleure paire acceptable, on la
 * verrouille, on retire les deux, on recommence. Déterministe (donc rejouable
 * et débogable), et il sert la meilleure qualité en premier — ce qui est le
 * bon arbitrage quand le vivier est le facteur limitant.
 *
 * La force d'une paire est le MINIMUM des deux scores directionnels : c'est le
 * maillon faible qui décide. Sans ça, on imposerait à quelqu'un un partenaire
 * qui ne lui correspond pas sous prétexte que LUI est enthousiaste.
 */
function apparier({
  profils, eligibles, plancher = 0, verrouillees = [], seed = '',
  score, desirabilite = desirabiliteParDefaut, config = {},
} = {}) {
  if (typeof score !== 'function') {
    // Volontairement fatal : sans injection, on retomberait sur une formule
    // maison — c'est-à-dire un SECOND score qui divergerait de `ranking.js`.
    throw new Error('apparier: le score unifié (ranking.js) doit être injecté');
  }
  const cfg = { ...CONFIG_DEFAUT, ...config };
  const pris = new Set();
  const paires = [];

  // ① Les aventures commencées sortent du vivier, quoi qu'en dise le score.
  //    Une proposition est substituable ; une aventure ne l'est JAMAIS.
  for (const [a, b] of verrouillees) {
    paires.push([a, b]);
    pris.add(a); pris.add(b);
  }

  const ids = [...profils.keys()].filter((id) => !pris.has(id));

  // ② Toutes les paires acceptables, avec leur force.
  const candidates = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === b) continue;                                  // jamais soi-même
      // L'éligibilité doit être RÉCIPROQUE : les filtres durs sont directionnels.
      if (!(eligibles.get(a) || []).includes(b)) continue;
      if (!(eligibles.get(b) || []).includes(a)) continue;

      const pa = profils.get(a);
      const pb = profils.get(b);
      const sAB = score(pa, pb);
      const sBA = score(pb, pa);
      // Le plancher vaut pour LES DEUX.
      if (sAB < plancher || sBA < plancher) continue;

      // Le maillon faible décide de la force de la paire…
      // …et l'ÉCART DE DÉSIRABILITÉ la pénalise : c'est ce qui met les très
      // désirés ensemble et les moins désirés ensemble. Sans cette pénalité,
      // le glouton accepterait volontiers une paire très déséquilibrée dès que
      // le maillon faible passe le plancher.
      const ecart = Math.abs(desirabilite(pa) - desirabilite(pb));
      const force = Math.min(sAB, sBA) - cfg.poidsEcartDesirabilite * ecart;
      // Départage : la disponibilité d'abord (elle ne fait QUE départager), puis
      // un jitter déterministe pour que deux paires strictement identiques ne
      // dépendent pas de l'ordre d'itération.
      const dispo = (pa?.enLigne ? 1 : 0) + (pb?.enLigne ? 1 : 0);
      candidates.push({ a, b, force, dispo, bruit: jitter(seed, clePaire(a, b)) });
    }
  }

  // ③ Glouton : la meilleure paire d'abord.
  candidates.sort((x, y) => (
    y.force - x.force            // la compatibilité prime toujours…
    || y.dispo - x.dispo         // …puis la disponibilité départage les ex æquo…
    || y.bruit - x.bruit         // …puis un bruit stable tranche le reste.
    || clePaire(x.a, x.b).localeCompare(clePaire(y.a, y.b))
  ));

  for (const { a, b } of candidates) {
    if (pris.has(a) || pris.has(b)) continue;   // un seul mystère chacun
    paires.push([a, b]);
    pris.add(a); pris.add(b);
  }

  // ④ Ceux qui restent n'ont PAS de mystère — et on l'assume.
  const sansMystere = [...profils.keys()].filter((id) => !pris.has(id));
  return { paires, sansMystere };
}

module.exports = {
  apparier, desirabiliteParDefaut,
  estDansLaFenetre, prochainTirage, plancherApplicable, tirageDuJour,
  CONFIG_DEFAUT,
};
