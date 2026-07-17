const supabase = require('../config/supabase');
const config = require('../config');
const logger = require('../utils/logger');
const { fromRow, photoCount } = require('./profile.model');
const { idForCode } = require('./reference.model');
const eventsModel = require('./events.model');
const { orderDeck, lockPhotos, acceptsMe } = require('../domain/deck');
const { ageFromBirthDate } = require('./profile.model');
const { scoreCandidates } = require('../domain/ranking');
const { resolveTier } = require('../domain/access');

// Version « carte » : mêmes relations que le profil complet, en plus léger.
// origin_country / premium_tier / premium_until nourrissent le RANKING
// (compatibilité d'origine, multiplicateur d'abonné payé) — jamais le client.
const SELECT_CARD = `
  id, first_name, birth_date, bio, avatar_url, origin_country,
  current_country, current_city, current_lat, current_lng, target_country, target_city, open_to_relocate,
  primary_language, spoken_languages, is_verified, is_premium, premium_tier, premium_until, last_active_at, created_at,
  hide_online_status, intention, boost_active_until,
  gender:genders!gender_id(code, display_name),
  goal:relationship_goals!relationship_goal_id(code, display_name),
  photos:profile_photos(id, url, position),
  interests:profile_interests(interest:interests(code, display_name)),
  prompts:profile_prompts(answer, position, prompt:prompts(code, question)),
  prefs:match_preferences(seeking_gender_id, min_age, max_age)
`.trim();

/**
 * Contexte de découverte partagé (file ET comptage) : qui exclure, qui m'a
 * likée (laissés passer même en incognito), et ma propre route/langues.
 */
async function discoveryContext(userId) {
  const [{ data: swiped }, { data: blockedBy }, { data: iBlocked }, { data: me }, { data: likers }, { data: mesInterets }] = await Promise.all([
    supabase.from('swipes').select('target_id').eq('swiper_id', userId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', userId),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('profiles')
      .select('current_country, current_city, current_lat, current_lng, target_country, target_city, spoken_languages, intention, origin_country, gender_id, birth_date')
      .eq('id', userId)
      .maybeSingle(),
    // Qui m'a likée + le palier du likeur (Priority Likes / mot avant match) et
    // le mot laissé avec un like ciblé.
    supabase.from('swipes')
      .select('swiper_id, like_comment, action:swipe_actions!action_id(code), swiper:profiles!swiper_id(premium_tier, premium_until)')
      .eq('target_id', userId),
    // Mes intérêts : nécessaires au filtre « au moins un intérêt en commun ».
    supabase.from('profile_interests')
      .select('interest:interests(code)')
      .eq('profile_id', userId),
  ]);
  const excluded = new Set([userId]);
  (swiped || []).forEach((r) => excluded.add(r.target_id));
  (blockedBy || []).forEach((r) => excluded.add(r.blocker_id));
  (iBlocked || []).forEach((r) => excluded.add(r.blocked_id));

  const likerIds = (likers || [])
    .filter((r) => r.action?.code === 'like' || r.action?.code === 'super_like')
    .map((r) => r.swiper_id);

  // Qui m'a SUPER-likée : leur carte remonte en tête de mon deck, marquée en
  // clair (le Super Like traverse le paywall par le deck — doctrine 15/07).
  const superLikerIds = new Set(
    (likers || []).filter((r) => r.action?.code === 'super_like').map((r) => r.swiper_id),
  );

  // Avantages Prestige (Lot F). Le palier du likeur est résolu par le DOMAINE ;
  // `freeTierWomen: false` volontairement : un palier OFFERT n'atteint jamais
  // Prestige, donc n'accorde ni Priority Like ni mot avant match.
  const now = Date.now();
  const estPrestige = (r) => resolveTier({
    premiumTier: r.swiper?.premium_tier ?? null,
    premiumUntil: r.swiper?.premium_until ?? null,
    genderCode: null,
    freeTierWomen: false,
    now,
  }).tier === 'prestige';

  // Priority Likes : les likes d'un Prestige passent devant, en permanence.
  const priorityLikerIds = new Set(
    (likers || [])
      .filter((r) => (r.action?.code === 'like' || r.action?.code === 'super_like') && estPrestige(r))
      .map((r) => r.swiper_id),
  );

  // Mot avant match : ATTACHÉ AU SUPER LIKE d'un Prestige — son mot m'est lisible
  // avant tout match (pour les autres, il n'arrive qu'au match via seedOpeners).
  const motsAvantMatch = new Map(
    (likers || [])
      .filter((r) => r.action?.code === 'super_like' && r.like_comment && estPrestige(r))
      .map((r) => [r.swiper_id, r.like_comment]),
  );

  const mesInteretsCodes = (mesInterets || []).map((r) => r.interest?.code).filter(Boolean);

  return { excluded, likerIds, superLikerIds, priorityLikerIds, motsAvantMatch, me, mesInteretsCodes };
}

/**
 * Réciprocité (post-filtre JS, relation jointe) : ne garder que les candidats
 * dont les préférences M'ACCEPTENT (genre + tranche d'âge). L'embed one-to-one
 * peut arriver en objet ou en tableau selon la détection PostgREST → normalisé.
 */
function filterByReciprocity(rows, me) {
  const ctx = { myGenderId: me?.gender_id ?? null, myAge: ageFromBirthDate(me?.birth_date) };
  return rows.filter((r) => acceptsMe(Array.isArray(r.prefs) ? r.prefs[0] : r.prefs, ctx));
}

/**
 * « Au moins un intérêt en commun » — post-filtre (la relation intérêts est jointe,
 * pas comparable dans la requête). Sans intérêt de MON côté, le filtre ne peut rien
 * dire : on le laisse passer plutôt que de vider la pile.
 */
function filterBySharedInterest(rows, prefs, mesInteretsCodes) {
  if (!prefs?.require_shared_interest || !mesInteretsCodes?.length) return rows;
  const mine = new Set(mesInteretsCodes);
  return rows.filter((r) => (r.interests || []).some((i) => mine.has(i.interest?.code)));
}

/** Filtres de base : vivant, onboardé, découvrable, non exclu, incognito. */
function applyBaseFilters(query, excluded, likerIds) {
  query = query
    .is('deleted_at', null)
    .eq('onboarding_done', true)
    .eq('is_discoverable', true)                          // profils en pause = invisibles
    .not('id', 'in', `(${[...excluded].join(',')})`);

  // Incognito : hors découverte, SAUF pour les profils qui m'ont déjà likée.
  if (likerIds.length) {
    return query.or(`incognito.eq.false,id.in.(${likerIds.join(',')})`);
  }
  return query.eq('incognito', false);
}

/**
 * Filtres issus des préférences (`prefs` en noms de colonnes match_preferences).
 * Le nombre de photos minimum N'EST PAS ici — il se post-filtre (relation jointe).
 * Partagé par `candidates` et `countCandidates` pour que le compteur ne mente jamais.
 */
function applyPrefFilters(query, prefs, me) {
  if (prefs?.seeking_gender_id) query = query.eq('gender_id', prefs.seeking_gender_id);
  if (prefs?.seeking_goal_id)   query = query.eq('relationship_goal_id', prefs.seeking_goal_id);

  // Pays de recherche (mono, ISO alpha-2) — vide = partout dans le monde.
  // Le RAYON, lui, se post-filtre en JS (haversine), il n'est pas ici.
  if (prefs?.search_country) query = query.eq('current_country', prefs.search_country);

  // Langue en commun → intersection avec mes langues (opérateur overlap).
  if (prefs?.require_common_language && me?.spoken_languages?.length) {
    query = query.overlaps('spoken_languages', me.spoken_languages);
  }

  // Filtres qualité.
  if (prefs?.require_bio)   query = query.not('bio', 'is', null);
  if (prefs?.verified_only) query = query.eq('is_verified', true);

  // ── v2 (migration 015) : les champs du profil, devenus filtres ──────────────
  // Origine — le pays d'où l'on VIENT, pas celui où l'on vit (search_country).
  if (prefs?.origin_country) query = query.eq('origin_country', prefs.origin_country);

  // Taille : une borne posée exclut les profils sans taille renseignée (sinon on
  // laisserait passer des profils dont on ne sait rien — ce n'est pas un filtre).
  if (prefs?.min_height) query = query.gte('height_cm', prefs.min_height);
  if (prefs?.max_height) query = query.lte('height_cm', prefs.max_height);

  // Mode de vie : {kind: [codes]} → `lifestyle->>kind IN (codes)` par catégorie.
  for (const [kind, codes] of Object.entries(prefs?.lifestyle_filters ?? {})) {
    if (Array.isArray(codes) && codes.length) query = query.in(`lifestyle->>${kind}`, codes);
  }
  // Les intérêts partagés se post-filtrent (relation jointe, comme min_photos).

  // Tranche d'âge → bornes de date de naissance (max_age plus vieux = date la plus ancienne).
  if (prefs?.min_age || prefs?.max_age) {
    const today = new Date();
    if (prefs.min_age) {
      const maxBirth = new Date(today.getFullYear() - prefs.min_age, today.getMonth(), today.getDate());
      query = query.lte('birth_date', maxBirth.toISOString().slice(0, 10));
    }
    if (prefs.max_age) {
      const minBirth = new Date(today.getFullYear() - prefs.max_age - 1, today.getMonth(), today.getDate());
      query = query.gte('birth_date', minBirth.toISOString().slice(0, 10));
    }
  }
  return query;
}

/**
 * File de découverte pour `userId`.
 * On exclut : soi-même, les profils déjà swipés, et les blocages (dans les deux
 * sens). On applique ensuite les préférences (genre recherché, tranche d'âge,
 * régions). Le monde entier est éligible par défaut — c'est tout l'intérêt de
 * Mbenguiste : aucune barrière de frontière ni d'origine.
 */
async function candidates(userId, { limit = 20 } = {}) {
  const { excluded, likerIds, superLikerIds, priorityLikerIds, motsAvantMatch, me, mesInteretsCodes } = await discoveryContext(userId);

  const [{ data: prefs }, mesPhotos] = await Promise.all([
    supabase
      .from('match_preferences')
      .select('seeking_gender_id, seeking_goal_id, min_age, max_age, search_country, search_radius_km, require_common_language, min_photos, require_bio, verified_only, origin_country, min_height, max_height, require_shared_interest, lifestyle_filters')
      .eq('profile_id', userId)
      .maybeSingle(),
    // Verrou de réciprocité photos : combien de photos J'AI (cf. lockPhotos).
    photoCount(userId),
  ]);

  let query = applyBaseFilters(supabase.from('profiles').select(SELECT_CARD), excluded, likerIds);
  query = applyPrefFilters(query, prefs, me);

  // Le tri SQL par activité n'est plus l'ordre du deck : c'est l'ÉLARGISSEUR DE
  // POOL du ranking (on retient les POOL plus actifs, le score fait le reste).
  // Conséquence assumée : les profils au-delà du pool n'apparaissent qu'une
  // fois le pool swipé — un fond de catalogue inactif peut attendre.
  const pool = Math.min(Math.max(limit * 5, 100), 200);
  query = query.order('last_active_at', { ascending: false }).limit(pool);

  const { data, error } = await query;
  if (error) throw error;
  // Entonnoir de diagnostic (DEBUG_DECK=on) : d'où viennent les cartes perdues.
  const funnel = { exclus: excluded.size - 1, pool: (data || []).length };
  // Nombre de photos minimum : post-filtre (la relation photos est jointe, pas
  // comptable dans la requête). Peut réduire le lot sous `limit` — acceptable.
  let rows = prefs?.min_photos
    ? (data || []).filter((r) => (r.photos?.length ?? 0) >= prefs.min_photos)
    : (data || []);
  funnel.apresPhotosMin = rows.length;
  // Rayon (km) autour de MA position — post-filtre JS (haversine).
  rows = filterByRadius(rows, prefs, me);
  funnel.apresRayon = rows.length;
  // Au moins un intérêt en commun — post-filtre JS (relation jointe).
  rows = filterBySharedInterest(rows, prefs, mesInteretsCodes);
  funnel.apresInteretCommun = rows.length;
  // Réciprocité : seuls restent les candidats dont les préférences m'acceptent.
  rows = filterByReciprocity(rows, me);
  funnel.apresReciprocite = rows.length;
  const mapped = rows.map((row) => ({
    ...fromRow(row),
    routesCroisees: crossesRoutes(me, row),
    // Mot avant match (Prestige) : lisible AVANT tout match, sinon null.
    motAvantMatch: motsAvantMatch.get(row.id) ?? null,
  }));

  // Profils actuellement « boostés » (crédit dépensé) → haut de la pile.
  const now = Date.now();
  const boostedIds = new Set(
    rows.filter((r) => r.boost_active_until && new Date(r.boost_active_until).getTime() > now).map((r) => r.id),
  );

  // Signaux de télémétrie du pool : engagement reçu (qualité) + rotation
  // (déjà montré à MOI sans swipe). Agrégats seulement — jamais les bruts.
  const ids = rows.map((r) => r.id);
  const [engagement, impressions] = await Promise.all([
    eventsModel.engagementByIds(ids),
    eventsModel.impressionsFor(userId, ids),
  ]);

  // Le SCORE se calcule sur les lignes BRUTES (elles portent premium_tier,
  // origin_country, interests…) ; l'ordre s'applique aux cartes mappées.
  const scores = scoreCandidates(rows, {
    viewerId: userId,
    me,
    mesInteretsCodes,
    likerIds: new Set(likerIds),
    engagement,
    impressions,
    now,
  });

  // Ordre & marquage délégués au domaine pur : rangs payés ①②③ puis score.
  const deck = orderDeck(mapped, { superLikerIds, priorityLikerIds, boostedIds, scores })
    .slice(0, limit);
  funnel.servies = deck.length;

  // DEBUG_DECK=on : trace l'entonnoir complet (exclus = déjà swipés + blocages).
  // Ex. { exclus: 42, pool: 100, …, apresReciprocite: 18, servies: 18 } — si
  // `servies` < limit, la ligne dit exactement quel filtre a mangé les cartes.
  if (process.env.DEBUG_DECK === 'on') {
    logger.info(`[deck] viewer=${userId} ${JSON.stringify(funnel)}`);
  }

  // Verrou de réciprocité photos (réf Tinder) : sans 2 photos soi-même, chaque
  // carte ne livre que les 2 premières — la suite devient la slide « Débloquer
  // les photos ». Appliqué SERVEUR (incontournable) et APRÈS le scoring : le
  // ranking juge le vrai profil, pas la version tronquée.
  return lockPhotos(deck, {
    myPhotoCount: mesPhotos,
    required: config.limits.photosRequiredToView,
    visible: config.limits.photosRequiredToView,
  });
}

/**
 * « Vos routes se croisent » : l'autre rêve de là où je vis, ou je rêve de là
 * où l'autre vit. Comparaison au niveau ville quand les deux villes sont
 * renseignées (même pays requis), sinon au niveau pays.
 */
function crossesRoutes(me, other) {
  if (!me || !other) return false;
  const placeMatch = (dreamCity, dreamCountry, liveCity, liveCountry) => {
    if (!dreamCountry || !liveCountry || dreamCountry !== liveCountry) return false;
    const a = (dreamCity || '').trim().toLowerCase();
    const b = (liveCity || '').trim().toLowerCase();
    return a && b ? a === b : true;
  };
  return (
    placeMatch(other.target_city, other.target_country, me.current_city, me.current_country) ||
    placeMatch(me.target_city, me.target_country, other.current_city, other.current_country)
  );
}

// ── Distance (rayon en km) — haversine, post-filtre JS ───────────────────────
const EARTH_KM = 6371;
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Le rayon s'applique AUTOUR DE MA position, et seulement en LOCAL : pas de pays
 * choisi (partout) ou pays choisi == mon pays. En cross-border (autre pays), un
 * rayon autour de moi n'aurait pas de sens → on reste à l'échelle du pays.
 */
function shouldApplyRadius(prefs, me) {
  return !!prefs?.search_radius_km
    && me?.current_lat != null && me?.current_lng != null
    && (!prefs.search_country || prefs.search_country === me.current_country);
}

function filterByRadius(rows, prefs, me) {
  if (!shouldApplyRadius(prefs, me)) return rows;
  const km = prefs.search_radius_km;
  return rows.filter((r) => r.current_lat != null && r.current_lng != null
    && haversineKm(me.current_lat, me.current_lng, r.current_lat, r.current_lng) <= km);
}

/**
 * Compte les profils qui correspondraient aux préférences EN COURS D'ÉDITION
 * (aperçu live de la page Préférences) — sans les enregistrer. `apiPrefs` est au
 * format du front (genreRecherche, ageMin, …) ; on résout les codes en ids puis
 * on applique EXACTEMENT les mêmes filtres que `candidates` (helpers partagés).
 */
async function countCandidates(userId, apiPrefs = {}) {
  const { excluded, likerIds, me, mesInteretsCodes } = await discoveryContext(userId);

  const prefs = {
    seeking_gender_id: apiPrefs.genreRecherche ? await idForCode('genders', apiPrefs.genreRecherche) : null,
    seeking_goal_id: apiPrefs.objectifRecherche ? await idForCode('relationship_goals', apiPrefs.objectifRecherche) : null,
    min_age: apiPrefs.ageMin,
    max_age: apiPrefs.ageMax,
    search_country: apiPrefs.paysRecherche ?? null,
    search_radius_km: apiPrefs.rayonKm ?? null,
    require_common_language: apiPrefs.langueCommune,
    min_photos: apiPrefs.photosMin,
    require_bio: apiPrefs.avecBio,
    verified_only: apiPrefs.verifiesUniquement,
    origin_country: apiPrefs.origineRecherche ?? null,
    min_height: apiPrefs.tailleMin ?? null,
    max_height: apiPrefs.tailleMax ?? null,
    require_shared_interest: apiPrefs.interetsCommuns,
    lifestyle_filters: apiPrefs.lifestyleFiltres ?? {},
  };

  // La réciprocité (préférences du candidat) est une relation jointe, comme les
  // photos minimum, le rayon et l'intérêt commun : incomptable dans la requête.
  // On récupère donc TOUJOURS les lignes et on filtre en JS, exactement comme
  // `candidates` (le compteur ne doit jamais mentir).
  let q = applyBaseFilters(
    supabase.from('profiles').select('id, current_lat, current_lng, photos:profile_photos(id), interests:profile_interests(interest:interests(code)), prefs:match_preferences(seeking_gender_id, min_age, max_age)'),
    excluded, likerIds,
  );
  q = applyPrefFilters(q, prefs, me);
  const { data, error } = await q;
  if (error) throw error;
  let rows = data || [];
  if (prefs.min_photos) rows = rows.filter((r) => (r.photos?.length ?? 0) >= prefs.min_photos);
  rows = filterByRadius(rows, prefs, me);
  rows = filterBySharedInterest(rows, prefs, mesInteretsCodes);
  rows = filterByReciprocity(rows, me);
  return rows.length;
}

/**
 * « Qui m'a likée » : les profils qui m'ont envoyé un like/super_like et à qui je
 * n'ai PAS encore répondu (sinon = match ou pass), hors blocages. Triés du plus
 * récent au plus ancien. Renvoie des ids + méta (pas les profils — le contrôleur
 * ne charge les profils que pour les membres Or).
 */
async function likersPending(userId) {
  const [{ data: likers }, { data: mySwipes }, { data: blockedBy }, { data: iBlocked }] = await Promise.all([
    supabase.from('swipes')
      .select('swiper_id, created_at, action:swipe_actions!action_id(code)')
      .eq('target_id', userId),
    supabase.from('swipes').select('target_id').eq('swiper_id', userId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', userId),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
  ]);
  const iSwiped = new Set((mySwipes || []).map((r) => r.target_id));
  const blocked = new Set([
    ...(blockedBy || []).map((r) => r.blocker_id),
    ...(iBlocked || []).map((r) => r.blocked_id),
  ]);
  return (likers || [])
    .filter((r) => (r.action?.code === 'like' || r.action?.code === 'super_like')
      && !iSwiped.has(r.swiper_id) && !blocked.has(r.swiper_id))
    .map((r) => ({ id: r.swiper_id, superLike: r.action?.code === 'super_like', likedAt: r.created_at }))
    .sort((a, b) => new Date(b.likedAt).getTime() - new Date(a.likedAt).getTime());
}

/** Profils-cartes pour une liste d'ids (Map id→carte, respecte deleted_at). */
async function cardsByIds(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select(SELECT_CARD)
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, fromRow(row)]));
}

/**
 * Coordonnées (lat/lng) pour une liste d'ids — Map id→{lat,lng}. SERVEUR ONLY :
 * sert à calculer une distance sans jamais exposer la position brute au client.
 */
async function coordsByIds(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, current_lat, current_lng')
    .in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.id, { lat: r.current_lat, lng: r.current_lng }]));
}

/**
 * Cartes MASQUÉES (contexte « qui t'a liké ») : uniquement la photo FLOUTÉE de la
 * photo principale (position 0) + la dernière activité. AUCUN champ identifiant.
 */
async function maskedCardsByIds(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, last_active_at, photos:profile_photos(blur_url, position)')
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    const photos = (row.photos || []).slice().sort((a, b) => a.position - b.position);
    map.set(row.id, { blurUrl: photos[0]?.blur_url ?? null, lastActiveAt: row.last_active_at });
  }
  return map;
}

module.exports = { candidates, countCandidates, likersPending, cardsByIds, coordsByIds, maskedCardsByIds, haversineKm };
