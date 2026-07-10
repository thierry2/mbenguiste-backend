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

  return profileModel.findById(userId);
}

/** Préférences de découverte (filtres). */
async function getPreferences(userId) {
  const { data } = await supabase
    .from('match_preferences')
    .select('seeking_gender_id, min_age, max_age, max_distance_km, target_country, genders:seeking_gender_id(code)')
    .eq('profile_id', userId)
    .maybeSingle();
  if (!data) return { genreRecherche: null, ageMin: 18, ageMax: 60, distanceMaxKm: null, paysCible: null };
  return {
    genreRecherche: data.genders?.code ?? null,
    ageMin: data.min_age,
    ageMax: data.max_age,
    distanceMaxKm: data.max_distance_km ?? null,
    paysCible: data.target_country ?? null,
  };
}

async function setPreferences(userId, input) {
  const row = { profile_id: userId, updated_at: new Date().toISOString() };
  if (input.genreRecherche !== undefined)
    row.seeking_gender_id = input.genreRecherche ? await idForCode('genders', input.genreRecherche) : null;
  if (input.ageMin !== undefined) row.min_age = input.ageMin;
  if (input.ageMax !== undefined) row.max_age = input.ageMax;
  if (input.distanceMaxKm !== undefined) row.max_distance_km = input.distanceMaxKm;
  if (input.paysCible !== undefined) row.target_country = input.paysCible;

  const { error } = await supabase
    .from('match_preferences')
    .upsert(row, { onConflict: 'profile_id' });
  if (error) throw error;
  return getPreferences(userId);
}

module.exports = { updateProfile, getPreferences, setPreferences };
