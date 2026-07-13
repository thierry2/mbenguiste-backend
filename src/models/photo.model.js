const supabase = require('../config/supabase');

const MAX_PHOTOS = 6;

/** Ajoute une photo au profil (à la fin). Renvoie la liste à jour.
 *  `blurUrl` = version floutée (contextes masqués) ; null si génération échouée. */
async function add(profileId, url, blurUrl = null) {
  const { data: existing, error: e1 } = await supabase
    .from('profile_photos')
    .select('id, position')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (e1) throw e1;

  if ((existing?.length ?? 0) >= MAX_PHOTOS) {
    throw Object.assign(new Error(`Maximum ${MAX_PHOTOS} photos`), { statusCode: 400 });
  }
  const nextPos = existing?.length ? existing[existing.length - 1].position + 1 : 0;

  const { error } = await supabase
    .from('profile_photos')
    .insert({ profile_id: profileId, url, blur_url: blurUrl, position: nextPos });
  if (error) throw error;

  // La 1re photo devient l'avatar par défaut si aucun n'est défini.
  if (nextPos === 0) {
    await supabase.from('profiles')
      .update({ avatar_url: url })
      .eq('id', profileId)
      .is('avatar_url', null);
  }
  return list(profileId);
}

async function list(profileId) {
  const { data, error } = await supabase
    .from('profile_photos')
    .select('id, url, position')
    .eq('profile_id', profileId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => ({ id: p.id, url: p.url, position: p.position }));
}

/** Supprime une photo (vérifie l'appartenance) et renvoie la liste à jour. */
async function remove(profileId, photoId) {
  const { error } = await supabase
    .from('profile_photos')
    .delete()
    .eq('id', photoId)
    .eq('profile_id', profileId);
  if (error) throw error;
  return list(profileId);
}

module.exports = { add, list, remove, MAX_PHOTOS };
