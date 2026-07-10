const supabase = require('../config/supabase');

// Colonnes + relations imbriquées (photos, intérêts, prompts, libellés de référence).
const SELECT_PROFILE = `
  id, email, first_name, birth_date, bio, avatar_url,
  current_country, current_city, target_country, target_city, open_to_relocate,
  primary_language, spoken_languages, is_verified, is_premium, premium_until,
  onboarding_done, last_active_at, created_at,
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

    objectif:      row.goal?.code ?? null,
    objectifLabel: row.goal?.display_name ?? null,
    languePrincipale: row.primary_language ?? null,
    langues:       row.spoken_languages ?? [],

    estVerifie:    row.is_verified ?? false,
    estPremium:    row.is_premium ?? false,
    premiumJusquau: row.premium_until ?? null,
    onboardingFait: row.onboarding_done ?? false,

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
    lastActiveAt:  row.last_active_at,
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
  if (updates.objectifId      !== undefined) row.relationship_goal_id = updates.objectifId;
  if (updates.languePrincipale!== undefined) row.primary_language  = updates.languePrincipale;
  if (updates.langues         !== undefined) row.spoken_languages  = updates.langues;
  if (updates.onboardingFait  !== undefined) row.onboarding_done   = updates.onboardingFait;

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

/** Touch last_active_at (présence). Non bloquant, appelé sur /me. */
async function touchActivity(id) {
  await supabase.from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', id);
}

module.exports = { findById, ensureProfile, update, setInterests, touchActivity, ageFromBirthDate, fromRow };
