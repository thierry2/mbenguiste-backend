const supabase = require('../config/supabase');
const profileModel = require('../models/profile.model');
const { idForCode } = require('../models/reference.model');
const ApiError = require('../utils/apiError');

/** Met à jour le profil : résout les codes (genre/objectif) en ids avant l'écriture. */
async function updateProfile(userId, input) {
  const updates = { ...input };

  if (input.genre !== undefined) {
    updates.genreId = input.genre ? await idForCode('genders', input.genre) : null;
    delete updates.genre;
  }
  if (input.objectif !== undefined) {
    updates.objectifId = input.objectif ? await idForCode('relationship_goals', input.objectif) : null;
    delete updates.objectif;
  }

  // Garde-fou âge : Mbenguiste est réservé aux majeurs.
  if (input.dateNaissance !== undefined) {
    const age = profileModel.ageFromBirthDate(input.dateNaissance);
    if (age === null) throw ApiError.badRequest('Date de naissance invalide');
    if (age < 18) throw ApiError.forbidden('Mbenguiste est réservé aux personnes majeures.');
  }

  const profile = await profileModel.update(userId, updates);

  // Intérêts (liste de codes) → ids.
  if (Array.isArray(input.interets)) {
    const ids = [];
    for (const code of input.interets) {
      const id = await idForCode('interests', code);
      if (id) ids.push(id);
    }
    await profileModel.setInterests(userId, ids);
  }

  // Prompts ({code, reponse}) → lignes profile_prompts ordonnées.
  if (Array.isArray(input.prompts)) {
    const rows = [];
    for (const p of input.prompts) {
      const id = await idForCode('prompts', p.code);
      if (id) rows.push({ prompt_id: id, answer: p.reponse, position: rows.length });
    }
    await profileModel.setPrompts(userId, rows);
  }

  return profileModel.findById(userId);
}

/** Préférences de découverte (filtres). */
async function getPreferences(userId) {
  const { data } = await supabase
    .from('match_preferences')
    .select(`
      seeking_gender_id, min_age, max_age, search_country, search_radius_km,
      require_common_language, min_photos, require_bio, verified_only,
      genders:seeking_gender_id(code), goal:seeking_goal_id(code)
    `)
    .eq('profile_id', userId)
    .maybeSingle();
  if (!data) {
    return {
      genreRecherche: null, ageMin: 18, ageMax: 60, objectifRecherche: null,
      paysRecherche: null, rayonKm: null, langueCommune: false, photosMin: 0, avecBio: false, verifiesUniquement: false,
    };
  }
  return {
    genreRecherche: data.genders?.code ?? null,
    ageMin: data.min_age,
    ageMax: data.max_age,
    objectifRecherche: data.goal?.code ?? null,
    paysRecherche: data.search_country ?? null,   // ISO alpha-2, null = partout
    rayonKm: data.search_radius_km ?? null,        // null = sans limite
    langueCommune: data.require_common_language ?? false,
    photosMin: data.min_photos ?? 0,
    avecBio: data.require_bio ?? false,
    verifiesUniquement: data.verified_only ?? false,
  };
}

async function setPreferences(userId, input) {
  const row = { profile_id: userId, updated_at: new Date().toISOString() };
  if (input.genreRecherche !== undefined)
    row.seeking_gender_id = input.genreRecherche ? await idForCode('genders', input.genreRecherche) : null;
  if (input.objectifRecherche !== undefined)
    row.seeking_goal_id = input.objectifRecherche ? await idForCode('relationship_goals', input.objectifRecherche) : null;
  if (input.ageMin !== undefined) row.min_age = input.ageMin;
  if (input.ageMax !== undefined) row.max_age = input.ageMax;
  if (input.paysRecherche !== undefined) row.search_country = input.paysRecherche;
  if (input.rayonKm !== undefined) row.search_radius_km = input.rayonKm;
  if (input.langueCommune !== undefined) row.require_common_language = input.langueCommune;
  if (input.photosMin !== undefined) row.min_photos = input.photosMin;
  if (input.avecBio !== undefined) row.require_bio = input.avecBio;
  if (input.verifiesUniquement !== undefined) row.verified_only = input.verifiesUniquement;

  const { error } = await supabase
    .from('match_preferences')
    .upsert(row, { onConflict: 'profile_id' });
  if (error) throw error;
  return getPreferences(userId);
}

module.exports = { updateProfile, getPreferences, setPreferences };
