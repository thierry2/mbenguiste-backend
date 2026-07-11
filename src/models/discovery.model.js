const supabase = require('../config/supabase');
const { fromRow } = require('./profile.model');

// Version « carte » : mêmes relations que le profil complet, en plus léger.
const SELECT_CARD = `
  id, first_name, birth_date, bio, avatar_url,
  current_country, current_city, target_country, target_city, open_to_relocate,
  primary_language, spoken_languages, is_verified, is_premium, last_active_at, created_at,
  hide_online_status,
  gender:genders!gender_id(code, display_name),
  goal:relationship_goals!relationship_goal_id(code, display_name),
  photos:profile_photos(id, url, position),
  interests:profile_interests(interest:interests(code, display_name)),
  prompts:profile_prompts(answer, position, prompt:prompts(code, question))
`.trim();

/**
 * File de découverte pour `userId`.
 * On exclut : soi-même, les profils déjà swipés, et les blocages (dans les deux
 * sens). On applique ensuite les préférences (genre recherché, tranche d'âge,
 * pays de destination souhaité). Le monde entier est éligible par défaut — c'est
 * tout l'intérêt de Mbenguiste : aucune barrière de frontière ni d'origine.
 */
async function candidates(userId, { limit = 20 } = {}) {
  // 1) IDs à exclure : déjà swipés + blocages réciproques. + ma propre route
  //    (pour marquer les profils dont la route croise la mienne). + qui m'a likée
  //    (pour laisser passer les profils incognito qui m'ont likée).
  const [{ data: swiped }, { data: blockedBy }, { data: iBlocked }, { data: me }, { data: likers }] = await Promise.all([
    supabase.from('swipes').select('target_id').eq('swiper_id', userId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', userId),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('profiles')
      .select('current_country, current_city, target_country, target_city')
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

  // Ceux qui m'ont likée (like/super_like) : autorisés même en incognito.
  const likerIds = (likers || [])
    .filter((r) => r.action?.code === 'like' || r.action?.code === 'super_like')
    .map((r) => r.swiper_id);

  // 2) Préférences de l'utilisateur.
  const { data: prefs } = await supabase
    .from('match_preferences')
    .select('seeking_gender_id, min_age, max_age, target_country')
    .eq('profile_id', userId)
    .maybeSingle();

  let query = supabase
    .from('profiles')
    .select(SELECT_CARD)
    .is('deleted_at', null)
    .eq('onboarding_done', true)
    .eq('is_discoverable', true)                          // profils en pause = invisibles
    .not('id', 'in', `(${[...excluded].join(',')})`);

  // Incognito : hors découverte, SAUF pour les profils qui m'ont déjà likée.
  if (likerIds.length) {
    query = query.or(`incognito.eq.false,id.in.(${likerIds.join(',')})`);
  } else {
    query = query.eq('incognito', false);
  }

  if (prefs?.seeking_gender_id) query = query.eq('gender_id', prefs.seeking_gender_id);
  if (prefs?.target_country)    query = query.eq('target_country', prefs.target_country);

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

  // Les plus actifs d'abord (proxy de qualité tant qu'on n'a pas de scoring dédié).
  query = query.order('last_active_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => ({
    ...fromRow(row),
    routesCroisees: crossesRoutes(me, row),
  }));
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

module.exports = { candidates };
