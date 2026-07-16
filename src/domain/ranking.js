'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Domaine RANKING — le score de pertinence du deck, en code PUR (zéro I/O).
//
// Doctrine : LA PERTINENCE EST MAÎTRESSE, LE PAYANT AMPLIFIE (décision 16/07).
// Architecture à deux étages, comme les grands du marché : les filtres durs
// (préférences) restent en SQL ; ici on SCORE le pool retenu. Les rangs payants
// ①②③ (super-like, Priority Like, Boost) restent dans orderDeck, AU-DESSUS du
// score : ce sont des promesses produit vendues, jamais diluées dedans.
//
// Score = Σ (poids × composant normalisé [0,1])  ≈ base 0–100
//         × subscriberFactor (abonné PAYÉ actif : léger, jamais un rang)
//         × reExposureFactor (rotation : déjà montré sans swipe → redescend)
//         × fairnessFactor  (anti-monopole : les profils stars cèdent du terrain)
//         + jitter journalier (deck stable 24 h, rebattu chaque jour, par viewer)
//
// Invariant cold-start : agrégats de sondes vides = engagement NEUTRE (0.5),
// pénalités à ×1 — le deck marche jour 1 sans aucune donnée de télémétrie.
// L'intention/route N'ENTRE PAS ici (concept abandonné le 14/07).
// ─────────────────────────────────────────────────────────────────────────────
const { resolveTier } = require('./access');
const { picksDaySeed } = require('./picks');

// Les DÉFAUTS vivent dans le domaine (précédent maison : W_* de picks.js).
// Chaque clé est surchargeable via ctx.config (fusion superficielle).
const DEFAULT_CONFIG = {
  weights: {
    compatibility: 30, // le plus gros poids : la pertinence est maîtresse
    freshness: 20,     // l'ancien tri unique last_active_at, devenu UN composant
    reciprocity: 15,   // m'a likée = P(réciproque) déjà à moitié gagnée
    engagement: 15,    // « engagement reçu » agrégé des sondes (V1 : global)
    quality: 10,       // complétude du profil (photos, bio, prompt, vérifié)
    newProfile: 10,    // fenêtre de visibilité des nouvelles têtes (cold start)
  },
  freshnessHalfLifeH: 48,        // demi-vie d'activité : 48 h → 0.5
  newProfileFullH: 48,           // plein boost jusqu'à 48 h…
  newProfileZeroH: 96,           // …décroissance linéaire, éteint à 96 h
  minImpressionsForEngagement: 20, // sous ce seuil, l'engagement reste neutre
  dwellNormMs: 8000,             // 8 s de dwell moyen = attention maximale
  openRateCeiling: 0.5,          // 1 ouverture de profil / 2 cartes = plafond
  likeRateNormCeiling: 0.6,      // 60 % de likes reçus = plafond du composant
  subscriberBoost: 1.12,         // abonné PAYÉ actif : +12 % (fourchette validée 10–15)
  reExposureDecay: 0.85,         // ×0.85 par vue sans swipe…
  reExposureCap: 4,              // …plafonnée à 4 (la carte doit pouvoir revenir)
  fairness: {
    likeRateCeiling: 0.45,       // au-delà de 45 % de likes reçus…
    minImpressions: 50,          // …ET un échantillon sérieux…
    damping: 0.85,               // …le profil star cède du terrain
  },
  jitterAmplitude: 1.5,          // ± points : départage les proches, jamais la pertinence
};

// ── Composants normalisés [0,1] ──────────────────────────────────────────────

/** Fraîcheur d'activité : décroissance exponentielle, demi-vie `halfLifeH`. */
function freshness(lastActiveAt, now, halfLifeH) {
  if (!lastActiveAt) return 0;
  const hours = Math.max(0, (now - Date.parse(lastActiveAt)) / 3600000);
  return 2 ** (-hours / halfLifeH);
}

/** Complétude du profil : ≥2 photos 0.3 (+0.1 si ≥4), bio étoffée 0.2, prompt 0.2, vérifié 0.2. */
function quality(row) {
  let q = 0;
  const photos = row.photos?.length ?? 0;
  if (photos >= 2) q += 0.3;
  if (photos >= 4) q += 0.1;
  if ((row.bio ?? '').trim().length >= 40) q += 0.2;
  if ((row.prompts?.length ?? 0) >= 1) q += 0.2;
  if (row.is_verified) q += 0.2;
  return q;
}

/**
 * Compatibilité viewer × candidat : intérêts communs (0.40, plafond 5), langues
 * communes (0.25, plafond 3), même origine (0.15), proximité géo (0.20, échelle
 * log — coords inconnues = NEUTRE 0.5, pas un malus).
 */
function compatibility(row, ctx) {
  const mine = new Set(ctx.mesInteretsCodes || []);
  let shared = 0;
  for (const i of row.interests || []) if (mine.has(i.interest?.code)) shared += 1;

  const myLangs = new Set(ctx.me?.spoken_languages || []);
  let langs = 0;
  for (const l of row.spoken_languages || []) if (myLangs.has(l)) langs += 1;

  const sameOrigin = !!(row.origin_country && ctx.me?.origin_country
    && row.origin_country === ctx.me.origin_country);

  return 0.40 * (Math.min(shared, 5) / 5)
       + 0.25 * (Math.min(langs, 3) / 3)
       + 0.15 * (sameOrigin ? 1 : 0)
       + 0.20 * proximity(ctx.me, row);
}

/** Proximité [0,1] en échelle log : 0 km=1, ~100 km=0.5, ≥10 000 km=0. Inconnu = 0.5. */
function proximity(me, row) {
  if (me?.current_lat == null || me?.current_lng == null
    || row.current_lat == null || row.current_lng == null) return 0.5;
  const km = haversineKm(me.current_lat, me.current_lng, row.current_lat, row.current_lng);
  return 1 - Math.min(Math.log10(1 + km) / 4, 1);
}

/** Fenêtre de visibilité des nouveaux : 1 jusqu'à `fullH`, linéaire → 0 à `zeroH`. */
function newProfile(createdAt, now, config) {
  if (!createdAt) return 0;
  const hours = Math.max(0, (now - Date.parse(createdAt)) / 3600000);
  const { newProfileFullH: full, newProfileZeroH: zero } = config;
  if (hours <= full) return 1;
  if (hours >= zero) return 0;
  return (zero - hours) / (zero - full);
}

/**
 * Engagement reçu (agrégats des sondes) : dwell moyen (0.4), taux d'ouverture
 * de profil (0.3), taux de like (0.3). Sous `minImpressionsForEngagement`,
 * NEUTRE à 0.5 — deux impressions chanceuses ne trustent pas le deck.
 */
function engagementScore(eng, config) {
  if (!eng || eng.impressions < config.minImpressionsForEngagement) return 0.5;
  const avgDwell = eng.dwellMsTotal / eng.impressions;
  const dwell = Math.min(avgDwell, config.dwellNormMs) / config.dwellNormMs;
  const opens = Math.min(eng.profileOpens / eng.impressions, config.openRateCeiling)
    / config.openRateCeiling;
  const swipes = eng.likesReceived + eng.passesReceived;
  const likeRate = swipes > 0 ? eng.likesReceived / swipes : 0;
  const likes = Math.min(likeRate, config.likeRateNormCeiling) / config.likeRateNormCeiling;
  return 0.4 * dwell + 0.3 * opens + 0.3 * likes;
}

// ── Modificateurs multiplicatifs ─────────────────────────────────────────────

/**
 * Abonné PAYÉ actif : léger multiplicateur, jamais un rang. `freeTierWomen:
 * false` volontairement — un palier OFFERT n'achète pas de visibilité (même
 * invariant que Priority Like : l'offert ne monétise jamais, décision 16/07).
 */
function subscriberFactor(row, now, config) {
  const { tier } = resolveTier({
    premiumTier: row.premium_tier ?? null,
    premiumUntil: row.premium_until ?? null,
    genderCode: null,
    freeTierWomen: false,
    now,
  });
  return tier !== 'free' ? config.subscriberBoost : 1;
}

/** Rotation : ×decay par vue sans swipe, plafonnée — la carte doit pouvoir revenir. */
function reExposureFactor(seenCount, config) {
  return config.reExposureDecay ** Math.min(seenCount ?? 0, config.reExposureCap);
}

/** Anti-monopole : très liké ET très vu → cède du terrain aux autres. */
function fairnessFactor(eng, config) {
  if (!eng || eng.impressions < config.fairness.minImpressions) return 1;
  const swipes = eng.likesReceived + eng.passesReceived;
  const likeRate = swipes > 0 ? eng.likesReceived / swipes : 0;
  return likeRate > config.fairness.likeRateCeiling ? config.fairness.damping : 1;
}

// ── Jitter journalier (même FNV-1a que picks, seedé par viewer) ──────────────

function fnv01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000; // [0,1)
}

// ── Assemblage ───────────────────────────────────────────────────────────────

function mergeConfig(over) {
  return {
    ...DEFAULT_CONFIG,
    ...over,
    weights: { ...DEFAULT_CONFIG.weights, ...over?.weights },
    fairness: { ...DEFAULT_CONFIG.fairness, ...over?.fairness },
  };
}

/**
 * Score d'UN candidat (ligne SQL brute) — déterministe, SANS jitter.
 * ctx : { me, mesInteretsCodes, likerIds:Set, engagement:Map, impressions:Map,
 *         now, viewerId, config? }.
 */
function scoreCandidate(row, ctx) {
  const config = mergeConfig(ctx.config);
  const w = config.weights;
  const eng = ctx.engagement?.get(row.id);

  const base = w.freshness * freshness(row.last_active_at, ctx.now, config.freshnessHalfLifeH)
    + w.compatibility * compatibility(row, ctx)
    + w.reciprocity * (ctx.likerIds?.has(row.id) ? 1 : 0)
    + w.quality * quality(row)
    + w.newProfile * newProfile(row.created_at, ctx.now, config)
    + w.engagement * engagementScore(eng, config);

  return base
    * subscriberFactor(row, ctx.now, config)
    * reExposureFactor(ctx.impressions?.get(row.id)?.seenCount, config)
    * fairnessFactor(eng, config);
}

/**
 * Scores d'un pool : Map id→score, jitter journalier inclus (± amplitude,
 * seedé jour × viewer × candidat → deck stable 24 h, rebattu chaque jour,
 * différent pour chaque viewer). C'est CETTE Map qu'orderDeck consomme.
 */
function scoreCandidates(rows, ctx) {
  const config = mergeConfig(ctx.config);
  const seed = picksDaySeed(ctx.now);
  return new Map(rows.map((row) => {
    const j = (fnv01(`${seed}:${ctx.viewerId}:${row.id}`) * 2 - 1) * config.jitterAmplitude;
    return [row.id, scoreCandidate(row, ctx) + j];
  }));
}

// ── Haversine (dupliqué de discovery.model : le domaine reste sans I/O) ──────
const EARTH_KM = 6371;
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.sqrt(a));
}

module.exports = {
  DEFAULT_CONFIG,
  freshness,
  quality,
  compatibility,
  newProfile,
  engagementScore,
  subscriberFactor,
  reExposureFactor,
  fairnessFactor,
  scoreCandidate,
  scoreCandidates,
};
