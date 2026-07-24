const supabase = require('../config/supabase');
const profileModel = require('../models/profile.model');
const { idForCode: defaultIdForCode } = require('../models/reference.model');
const ApiError = require('../utils/apiError');

// ─────────────────────────────────────────────────────────────────────────────
// Édition du profil. Le verrou du genre (doctrine §3, garde-fou de la gratuité
// femmes) vit ici : le genre se pose UNE fois (onboarding) puis devient
// immuable — sinon un homme se déclare femme pour l'Or offert.
//
// `updateProfile` est une factory à dépendances injectées (testable à sec).
// getPreferences/setPreferences restent des fonctions module (I/O direct
// Supabase, non concernées par le verrou) et sont ré-exportées telles quelles.
// ─────────────────────────────────────────────────────────────────────────────

function createProfileService({ profiles, idForCode }) {
  /** Met à jour le profil : résout les codes (genre/objectif) en ids avant l'écriture. */
  async function updateProfile(userId, input) {
    const updates = { ...input };

    if (input.genre !== undefined) {
      // Verrou : on lit le genre courant AVANT toute écriture.
      const current = await profiles.findById(userId);
      const currentGenre = current?.genre ?? null;

      if (currentGenre !== null && input.genre !== currentGenre) {
        // Déjà posé et on tente de le CHANGER (ou de l'effacer) → refus net.
        throw ApiError.forbidden('Le genre ne peut pas être modifié après l\'inscription.');
      }

      if (currentGenre === null) {
        // Premier réglage (onboarding) : autorisé.
        updates.genreId = input.genre ? await idForCode('genders', input.genre) : null;
      }
      // Re-poser la même valeur : no-op idempotent (on n'écrit pas le genre à nouveau).
      delete updates.genre;
    }

    if (input.objectif !== undefined) {
      updates.objectifId = input.objectif ? await idForCode('relationship_goals', input.objectif) : null;
      delete updates.objectif;
    }

    // Garde-fou âge : Mbenguiste est réservé aux majeurs.
    if (input.dateNaissance !== undefined) {
      const age = profiles.ageFromBirthDate(input.dateNaissance);
      if (age === null) throw ApiError.badRequest('Date de naissance invalide');
      if (age < 18) throw ApiError.forbidden('Mbenguiste est réservé aux personnes majeures.');
    }

    await profiles.update(userId, updates);

    // Intérêts (liste de codes) → ids.
    if (Array.isArray(input.interets)) {
      const ids = [];
      for (const code of input.interets) {
        const id = await idForCode('interests', code);
        if (id) ids.push(id);
      }
      await profiles.setInterests(userId, ids);
    }

    // Prompts ({code, reponse}) → lignes profile_prompts ordonnées.
    if (Array.isArray(input.prompts)) {
      const rows = [];
      for (const p of input.prompts) {
        const id = await idForCode('prompts', p.code);
        if (id) rows.push({ prompt_id: id, answer: p.reponse, position: rows.length });
      }
      await profiles.setPrompts(userId, rows);
    }

    return profiles.findById(userId);
  }

  return { updateProfile };
}

/** Préférences de découverte (filtres). */
async function getPreferences(userId) {
  const { data } = await supabase
    .from('match_preferences')
    .select(`
      seeking_gender_id, min_age, max_age, search_country, search_radius_km,
      search_anchor_lat, search_anchor_lng, search_anchor_label, expand_if_empty,
      require_common_language, min_photos, require_bio, verified_only,
      origin_country, min_height, max_height, require_shared_interest, lifestyle_filters,
      genders:seeking_gender_id(code), goal:seeking_goal_id(code)
    `)
    .eq('profile_id', userId)
    .maybeSingle();
  if (!data) {
    return {
      genreRecherche: null, ageMin: 18, ageMax: 60, objectifRecherche: null,
      paysRecherche: null, rayonKm: null, langueCommune: false, photosMin: 0, avecBio: false, verifiesUniquement: false,
      origineRecherche: null, tailleMin: null, tailleMax: null, interetsCommuns: false, lifestyleFiltres: {},
      // Ancre de recherche (Passeport) : vide = « autour de moi ».
      ancreLat: null, ancreLng: null, ancreLabel: null, elargirSiVide: false,
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
    // v2 : les champs du profil, devenus filtrables (migration 015).
    origineRecherche: data.origin_country ?? null,
    tailleMin: data.min_height ?? null,
    tailleMax: data.max_height ?? null,
    interetsCommuns: data.require_shared_interest ?? false,
    lifestyleFiltres: data.lifestyle_filters ?? {},
    // Ancre de recherche : vide = « autour de moi » (comportement par défaut).
    // Renseignée = un lieu choisi (Passeport). Le libellé permet à l'app
    // d'ancrer le rayon à un lieu NOMMÉ plutôt qu'à des coordonnées.
    ancreLat: data.search_anchor_lat ?? null,
    ancreLng: data.search_anchor_lng ?? null,
    ancreLabel: data.search_anchor_label ?? null,
    elargirSiVide: data.expand_if_empty ?? false,
  };
}

async function setPreferences(userId, input) {
  const row = { profile_id: userId, updated_at: new Date().toISOString() };
  if (input.genreRecherche !== undefined)
    row.seeking_gender_id = input.genreRecherche ? await defaultIdForCode('genders', input.genreRecherche) : null;
  if (input.objectifRecherche !== undefined)
    row.seeking_goal_id = input.objectifRecherche ? await defaultIdForCode('relationship_goals', input.objectifRecherche) : null;
  if (input.ageMin !== undefined) row.min_age = input.ageMin;
  if (input.ageMax !== undefined) row.max_age = input.ageMax;
  if (input.paysRecherche !== undefined) row.search_country = input.paysRecherche;
  if (input.rayonKm !== undefined) row.search_radius_km = input.rayonKm;
  if (input.langueCommune !== undefined) row.require_common_language = input.langueCommune;
  if (input.photosMin !== undefined) row.min_photos = input.photosMin;
  if (input.avecBio !== undefined) row.require_bio = input.avecBio;
  if (input.verifiesUniquement !== undefined) row.verified_only = input.verifiesUniquement;
  if (input.origineRecherche !== undefined) row.origin_country = input.origineRecherche;
  if (input.tailleMin !== undefined) row.min_height = input.tailleMin;
  if (input.tailleMax !== undefined) row.max_height = input.tailleMax;
  if (input.interetsCommuns !== undefined) row.require_shared_interest = input.interetsCommuns;
  if (input.elargirSiVide !== undefined) row.expand_if_empty = input.elargirSiVide;
  // L'ancre est un COUPLE : on écrit les deux ou aucune (la base a une contrainte
  // en ce sens, cf. migration 042). `null` explicite = revenir « autour de moi ».
  if (input.ancreLat !== undefined || input.ancreLng !== undefined) {
    const lat = input.ancreLat ?? null;
    const lng = input.ancreLng ?? null;
    const complet = lat !== null && lng !== null;
    row.search_anchor_lat = complet ? lat : null;
    row.search_anchor_lng = complet ? lng : null;
    if (!complet) row.search_anchor_label = null;   // pas d'ancre, pas de nom
  }
  if (input.ancreLabel !== undefined && row.search_anchor_label === undefined) {
    row.search_anchor_label = input.ancreLabel;
  }
  // On ne garde que les catégories réellement contraintes ({} = indifférent).
  if (input.lifestyleFiltres !== undefined) {
    row.lifestyle_filters = Object.fromEntries(
      Object.entries(input.lifestyleFiltres).filter(([, codes]) => Array.isArray(codes) && codes.length > 0),
    );
  }

  const { error } = await supabase
    .from('match_preferences')
    .upsert(row, { onConflict: 'profile_id' });
  if (error) throw error;
  return getPreferences(userId);
}

const defaultService = createProfileService({
  profiles: profileModel,
  idForCode: defaultIdForCode,
});

module.exports = {
  createProfileService,
  updateProfile: defaultService.updateProfile,
  getPreferences,
  setPreferences,
};
