const supabase = require('../config/supabase');
const { fromRow } = require('./profile.model');
const { idForCode } = require('./reference.model');

// Version « carte » : mêmes relations que le profil complet, en plus léger.
const SELECT_CARD = `
  id, first_name, birth_date, bio, avatar_url,
  current_country, current_city, current_lat, current_lng, target_country, target_city, open_to_relocate,
  primary_language, spoken_languages, is_verified, is_premium, last_active_at, created_at,
  hide_online_status, intention, boost_active_until,
  gender:genders!gender_id(code, display_name),
  goal:relationship_goals!relationship_goal_id(code, display_name),
  photos:profile_photos(id, url, position),
  interests:profile_interests(interest:interests(code, display_name)),
  prompts:profile_prompts(answer, position, prompt:prompts(code, question))
`.trim();

/**
 * Contexte de découverte partagé (file ET comptage) : qui exclure, qui m'a
 * likée (laissés passer même en incognito), et ma propre route/langues.
 */
async function discoveryContext(userId) {
  const [{ data: swiped }, { data: blockedBy }, { data: iBlocked }, { data: me }, { data: likers }] = await Promise.all([
    supabase.from('swipes').select('target_id').eq('swiper_id', userId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', userId),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('profiles')
      .select('current_country, current_city, current_lat, current_lng, target_country, target_city, spoken_languages, intention')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('swipes')
      .select('swiper_id, action:swipe_actions!action_id(code)')
      .eq('target_id', userId),
  ]);
  const excluded = new Set([userId]);
  (swiped || []).forEach((r) => excluded.add(r.target_id));
  (blockedBy || []).forEach((r) => excluded.add(r.blocker_id));
  (iBlocked || []).forEach((r) => excluded.add(r.blocked_id));

  const likerIds = (likers || [])
    .filter((r) => r.action?.code === 'like' || r.action?.code === 'super_like')
    .map((r) => r.swiper_id);

  return { excluded, likerIds, me };
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
  const { excluded, likerIds, me } = await discoveryContext(userId);

  const { data: prefs } = await supabase
    .from('match_preferences')
    .select('seeking_gender_id, seeking_goal_id, min_age, max_age, search_country, search_radius_km, require_common_language, min_photos, require_bio, verified_only')
    .eq('profile_id', userId)
    .maybeSingle();

  let query = applyBaseFilters(supabase.from('profiles').select(SELECT_CARD), excluded, likerIds);
  query = applyPrefFilters(query, prefs, me);

  // Les plus actifs d'abord (proxy de qualité tant qu'on n'a pas de scoring dédié).
  query = query.order('last_active_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  // Nombre de photos minimum : post-filtre (la relation photos est jointe, pas
  // comptable dans la requête). Peut réduire le lot sous `limit` — acceptable.
  let rows = prefs?.min_photos
    ? (data || []).filter((r) => (r.photos?.length ?? 0) >= prefs.min_photos)
    : (data || []);
  // Rayon (km) autour de MA position — post-filtre JS (haversine).
  rows = filterByRadius(rows, prefs, me);
  const mapped = rows.map((row) => ({
    ...fromRow(row),
    routesCroisees: crossesRoutes(me, row),
  }));

  // Profils actuellement « boostés » (crédit dépensé) → tout en haut de la pile.
  const now = Date.now();
  const boosted = new Set(
    rows.filter((r) => r.boost_active_until && new Date(r.boost_active_until).getTime() > now).map((r) => r.id),
  );

  // Ordre : ① boostés d'abord, ② intentions COMPLÉMENTAIRES (l'envol ↔ le retour,
  // cœur du produit), ③ activité (tri stable → conservée au sein de chaque groupe).
  mapped.sort((a, b) => {
    const ba = boosted.has(a.id) ? 1 : 0;
    const bb = boosted.has(b.id) ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return complementScore(me?.intention, b.intention) - complementScore(me?.intention, a.intention);
  });
  return mapped;
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

/** 1 si les intentions sont complémentaires (envol ↔ retour), 0 sinon. */
function complementScore(mine, theirs) {
  if (!mine || !theirs || mine === 'any' || theirs === 'any') return 0;
  return mine !== theirs ? 1 : 0;
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
  const { excluded, likerIds, me } = await discoveryContext(userId);

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
  };

  // Photos minimum OU rayon : incomptables dans la requête → on récupère les
  // lignes (ids + coords + photos) et on filtre en JS, comme `candidates`.
  if (prefs.min_photos || shouldApplyRadius(prefs, me)) {
    let q = applyBaseFilters(supabase.from('profiles').select('id, current_lat, current_lng, photos:profile_photos(id)'), excluded, likerIds);
    q = applyPrefFilters(q, prefs, me);
    const { data, error } = await q;
    if (error) throw error;
    let rows = data || [];
    if (prefs.min_photos) rows = rows.filter((r) => (r.photos?.length ?? 0) >= prefs.min_photos);
    rows = filterByRadius(rows, prefs, me);
    return rows.length;
  }

  // Sinon, comptage exact côté serveur (head = pas de lignes transférées).
  let q = applyBaseFilters(supabase.from('profiles').select('id', { count: 'exact', head: true }), excluded, likerIds);
  q = applyPrefFilters(q, prefs, me);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
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

module.exports = { candidates, countCandidates, likersPending, cardsByIds, maskedCardsByIds };
