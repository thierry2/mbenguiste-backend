'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine COUPS DE CŒUR — la sélection du jour, en code PUR (zéro I/O).
// Curation ALGORITHMIQUE (compatibilité : intérêts, langues, qualité de profil),
// jamais nourrie par les admirateurs (doctrine 15/07). Éphémère mais STABLE sur
// 24 h : un seed par jour rebat les cartes entre profils de compatibilité égale.
// ─────────────────────────────────────────────────────────────────────────────

const W_INTEREST = 3; // un intérêt partagé pèse plus qu'une langue…
const W_LANGUAGE = 2; // …qui pèse plus qu'un simple signal de qualité.
const W_BIO = 2;
const W_VERIFIED = 1;
const W_PHOTOS = 1;

function interestCodes(p) {
  return new Set((p?.interets || []).map((i) => i?.code).filter(Boolean));
}

/** Score de compatibilité viewer × candidat — déterministe, sans hasard. */
function compatibilityScore(viewer, candidate) {
  const mine = interestCodes(viewer);
  let shared = 0;
  for (const c of interestCodes(candidate)) if (mine.has(c)) shared += 1;

  const myLangs = new Set(viewer?.langues || []);
  let langs = 0;
  for (const l of candidate?.langues || []) if (myLangs.has(l)) langs += 1;

  let s = shared * W_INTEREST + langs * W_LANGUAGE;
  if (candidate?.bio && candidate.bio.trim()) s += W_BIO;
  if (candidate?.estVerifie) s += W_VERIFIED;
  if ((candidate?.photos?.length || 0) >= 2) s += W_PHOTOS;
  return s;
}

/** Jitter déterministe [0,1) à partir de (seed, id) — FNV-1a. < 1 : ne renverse
 *  jamais un écart de compatibilité réel, il ne départage que les ex æquo. */
function jitter(seed, id) {
  let h = 2166136261;
  const s = `${seed}:${id}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Le seau quotidien (UTC) : la sélection est identique toute la journée. */
function picksDaySeed(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

/**
 * Sélectionne les `count` profils les plus compatibles (jitter du jour en
 * départage). Nouvelle liste, source intacte.
 */
function selectDailyPicks(candidates, viewer, { count = 10, daySeed = '', now } = {}) {
  const seed = daySeed || picksDaySeed(now);
  return candidates
    .map((c) => ({ c, score: compatibilityScore(viewer, c) + jitter(seed, c.id) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.c);
}

module.exports = { compatibilityScore, selectDailyPicks, picksDaySeed };
