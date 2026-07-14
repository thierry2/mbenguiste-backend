const supabase = require('../config/supabase');

// Colonnes + relations imbriquées (photos, intérêts, prompts, libellés de référence).
const SELECT_PROFILE = `
  id, email, first_name, birth_date, bio, avatar_url,
  current_country, current_city, target_country, target_city, open_to_relocate, intention,
  height_cm, origin_country, occupation,
  primary_language, spoken_languages, is_verified, is_premium, premium_until,
  onboarding_done, last_active_at, created_at, lifestyle,
  notif_push, notif_email, notif_sms, is_discoverable, incognito, hide_online_status,
  gender:genders!gender_id(code, display_name),
  goal:relationship_goals!relationship_goal_id(code, display_name),
  photos:profile_photos(id, url, position),
  interests:profile_interests(interest:interests(code, display_name)),
  prompts:profile_prompts(answer, position, prompt:prompts(code, question))
`.trim();

/** Âge en années révolues — calculé serveur, jamais reçu du client. */
function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const beforeBirthday =
    now.getMonth() < d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  if (beforeBirthday) age--;
  return age;
}

/** Ligne SQL (colonnes EN) → objet applicatif (champs FR). */
function fromRow(row) {
  if (!row) return null;
  return {
    id:            row.id,
    prenom:        row.first_name,
    age:           ageFromBirthDate(row.birth_date),
    genre:         row.gender?.code ?? null,
    genreLabel:    row.gender?.display_name ?? null,
    bio:           row.bio ?? null,
    avatarUrl:     row.avatar_url ?? null,

    // La « route » — signature de Mbenguiste.
    villeActuelle: row.current_city ?? null,
    paysActuel:    row.current_country ?? null,
    villeCible:    row.target_city ?? null,
    paysCible:     row.target_country ?? null,
    ouvertAuDepart: row.open_to_relocate ?? false,
    intention:     row.intention ?? null,   // 'depart' | 'return' | 'any' | null

    objectif:      row.goal?.code ?? null,
    objectifLabel: row.goal?.display_name ?? null,

    // Carte d'identité — descripteurs de la vitrine.
    taille:        row.height_cm ?? null,       // cm
    origine:       row.origin_country ?? null,  // ISO alpha-2, distinct du pays où l'on vit
    metier:        row.occupation ?? null,

    languePrincipale: row.primary_language ?? null,
    langues:       row.spoken_languages ?? [],

    estVerifie:    row.is_verified ?? false,
    estPremium:    row.is_premium ?? false,
    premiumJusquau: row.premium_until ?? null,
    onboardingFait: row.onboarding_done ?? false,

    // Réglages (n'apparaissent que sur /me — pas exposés sur le profil d'autrui,
    // mais inoffensifs : booléens sans PII).
    reglages: {
      notifPush:      row.notif_push ?? true,
      notifEmail:     row.notif_email ?? true,
      notifSms:       row.notif_sms ?? false,
      discoverable:   row.is_discoverable ?? true,
      incognito:      row.incognito ?? false,
      masquerEnLigne: row.hide_online_status ?? false,
    },

    // Descripteurs mode de vie ({kind: code}) — résolus en libellés côté front (bootstrap).
    lifestyle: row.lifestyle ?? {},

    photos: (row.photos ?? [])
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ id: p.id, url: p.url, position: p.position })),
    interets: (row.interests ?? []).map((i) => ({
      code: i.interest?.code,
      label: i.interest?.display_name,
    })),
    prompts: (row.prompts ?? [])
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        code: p.prompt?.code,
        question: p.prompt?.question,
        reponse: p.answer,
      })),

    createdAt:     row.created_at,
    // « En ligne » masqué à la demande : on n'expose pas last_active_at.
    lastActiveAt:  row.hide_online_status ? null : (row.last_active_at ?? null),
  };
}

async function findById(id) {
  const { data, error } = await supabase
    .from('profiles')
    .select(SELECT_PROFILE)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return fromRow(data);
}

/** Crée le profil s'il n'existe pas encore (1re connexion). */
async function ensureProfile(user) {
  const { data: existing } = await supabase
    .from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (existing) return findById(user.id);

  const meta = user.user_metadata || {};
  const firstName = meta.given_name || meta.full_name?.split(' ')[0] || 'Membre';
  const { error } = await supabase.from('profiles').insert({
    id: user.id,
    email: user.email,
    first_name: firstName,
    // birth_date est NOT NULL : placeholder à compléter à l'onboarding. On met une
    // date lointaine (>18 ans) pour respecter la contrainte ; onboarding_done=false
    // force le passage par l'écran d'inscription qui la remplacera.
    birth_date: '1990-01-01',
    avatar_url: meta.avatar_url || meta.picture || null,
    onboarding_done: false,
  });
  if (error) throw error;
  return findById(user.id);
}

// Map champs FR (front) → colonnes EN. Les FK (genre/objectif) sont résolues en amont
// par le service (code → id) puis passées ici en *_id.
async function update(id, updates) {
  const row = { updated_at: new Date().toISOString() };
  if (updates.prenom          !== undefined) row.first_name        = updates.prenom;
  if (updates.dateNaissance   !== undefined) row.birth_date        = updates.dateNaissance;
  if (updates.genreId         !== undefined) row.gender_id         = updates.genreId;
  if (updates.bio             !== undefined) row.bio               = updates.bio;
  if (updates.avatarUrl       !== undefined) row.avatar_url        = updates.avatarUrl;
  if (updates.villeActuelle   !== undefined) row.current_city      = updates.villeActuelle;
  if (updates.paysActuel      !== undefined) row.current_country   = updates.paysActuel;
  if (updates.villeCible      !== undefined) row.target_city       = updates.villeCible;
  if (updates.paysCible       !== undefined) row.target_country    = updates.paysCible;
  if (updates.ouvertAuDepart  !== undefined) row.open_to_relocate  = updates.ouvertAuDepart;
  if (updates.intention       !== undefined) row.intention         = updates.intention;
  if (updates.taille          !== undefined) row.height_cm         = updates.taille;
  if (updates.origine         !== undefined) row.origin_country    = updates.origine;
  if (updates.metier          !== undefined) row.occupation        = updates.metier;
  if (updates.objectifId      !== undefined) row.relationship_goal_id = updates.objectifId;
  if (updates.languePrincipale!== undefined) row.primary_language  = updates.languePrincipale;
  if (updates.langues         !== undefined) row.spoken_languages  = updates.langues;
  if (updates.lifestyle       !== undefined) row.lifestyle         = updates.lifestyle;
  if (updates.onboardingFait  !== undefined) row.onboarding_done   = updates.onboardingFait;

  const { error } = await supabase.from('profiles').update(row).eq('id', id);
  if (error) throw error;
  return findById(id);
}

/** Met à jour les réglages (notifications + visibilité). Champs booléens optionnels. */
async function updateSettings(id, s) {
  const row = { updated_at: new Date().toISOString() };
  if (s.notifPush      !== undefined) row.notif_push          = !!s.notifPush;
  if (s.notifEmail     !== undefined) row.notif_email         = !!s.notifEmail;
  if (s.notifSms       !== undefined) row.notif_sms           = !!s.notifSms;
  if (s.discoverable   !== undefined) row.is_discoverable     = !!s.discoverable;
  if (s.incognito      !== undefined) row.incognito           = !!s.incognito;
  if (s.masquerEnLigne !== undefined) row.hide_online_status  = !!s.masquerEnLigne;
  const { error } = await supabase.from('profiles').update(row).eq('id', id);
  if (error) throw error;
  return findById(id);
}

/** Remplace les intérêts d'un profil (liste d'ids). */
async function setInterests(profileId, interestIds) {
  await supabase.from('profile_interests').delete().eq('profile_id', profileId);
  if (!interestIds?.length) return;
  const rows = interestIds.map((interest_id) => ({ profile_id: profileId, interest_id }));
  const { error } = await supabase.from('profile_interests').insert(rows);
  if (error) throw error;
}

/** Remplace les prompts d'un profil (lignes {prompt_id, answer, position}). */
async function setPrompts(profileId, rows) {
  await supabase.from('profile_prompts').delete().eq('profile_id', profileId);
  if (!rows?.length) return;
  const { error } = await supabase
    .from('profile_prompts')
    .insert(rows.map((r) => ({ ...r, profile_id: profileId })));
  if (error) throw error;
}

/** Premium actif ? (avec garde-fou : premium_until passé = expiré même si is_premium resté true). */
async function isPremium(id) {
  const { data } = await supabase
    .from('profiles')
    .select('is_premium, premium_until')
    .eq('id', id)
    .maybeSingle();
  if (!data?.is_premium) return false;
  if (data.premium_until && new Date(data.premium_until).getTime() < Date.now()) return false;
  return true;
}

/** Reflète l'état d'abonnement (appelé par le webhook RevenueCat, jamais par le client). */
async function setPremiumStatus(id, { isPremium: prem, premiumUntil }) {
  const { error } = await supabase.from('profiles').update({
    is_premium: !!prem,
    premium_until: premiumUntil ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

/** Enregistre la position (captée par expo-location) pour la recherche par rayon. */
async function setLocation(id, lat, lng) {
  const { error } = await supabase.from('profiles')
    .update({ current_lat: lat, current_lng: lng, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Touch last_active_at (présence). Non bloquant, appelé sur /me. */
async function touchActivity(id) {
  await supabase.from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Suppression douce (RGPD / stores). On NE supprime JAMAIS via auth.admin.deleteUser :
 * on pose `deleted_at` (le middleware auth renverra 403, findById l'exclut déjà) et on
 * anonymise les données personnelles + on coupe la découverte (retiré des files, photos
 * effacées). L'utilisateur reste techniquement en base le temps de purger proprement les
 * relations, mais n'est plus joignable ni visible.
 */
async function softDelete(id) {
  // Purge des contenus qui exposeraient encore l'utilisateur.
  await supabase.from('profile_photos').delete().eq('profile_id', id);
  await supabase.from('profile_interests').delete().eq('profile_id', id);
  await supabase.from('profile_prompts').delete().eq('profile_id', id);

  const { error } = await supabase.from('profiles').update({
    deleted_at: new Date().toISOString(),
    // Anonymisation des PII : plus rien d'identifiant ne subsiste dans la ligne.
    first_name: 'Membre',
    email: null,
    bio: null,
    avatar_url: null,
    current_city: null,
    target_city: null,
    occupation: null,
    origin_country: null,
    height_cm: null,
    primary_language: null,
    spoken_languages: [],
    push_token: null,
    is_verified: false,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

module.exports = { findById, ensureProfile, update, updateSettings, setInterests, setPrompts, touchActivity, softDelete, ageFromBirthDate, fromRow, isPremium, setPremiumStatus, setLocation };
