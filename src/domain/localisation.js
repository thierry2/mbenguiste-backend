'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// D'OÙ MESURE-T-ON, ET LE RAYON AGIT-IL VRAIMENT ? Pur, donc testable à sec.
//
// POURQUOI ÇA VIT ICI. La règle du rayon était enfouie dans `discovery.model`,
// et deux de ses conditions étaient INVISIBLES depuis l'app : sans position
// enregistrée, et en cherchant dans un pays étranger, le rayon ne filtrait
// RIEN — en silence. On réglait « 50 km » et il ne se passait rien.
//
// La règle remonte donc dans un module pur : l'app peut poser exactement les
// mêmes questions que le serveur (« ce rayon va-t-il agir ? ») et n'afficher le
// contrôle que quand la réponse est oui. Le no-op silencieux devient impossible
// par construction, au lieu d'être rattrapé par un avertissement.
//
// ── L'ANCRE, ET LE PASSEPORT ────────────────────────────────────────────────
// Le rayon se mesure depuis une ANCRE. Aujourd'hui elle est implicite : ma
// propre position. Demain elle pourra être CHOISIE (chercher autour de Paris
// depuis Douala) — c'est le « Passeport » des apps de référence, un produit
// vendable. Tout est prêt ici : `ancrePour` renvoie déjà la source, et
// `rayonApplicable` sait que le pays étranger ne bloque plus dès qu'une ancre
// explicite existe. Il ne restera qu'à écrire les coordonnées choisies.
// ─────────────────────────────────────────────────────────────────────────────

const RAYON_TERRE_KM = 6371;

/** En dessous de ce nombre de profils, le rayon a étranglé la file. */
const MIN_PROFILS_AVANT_ELARGISSEMENT = 5;

const toRad = (d) => (d * Math.PI) / 180;

/** Une coordonnée POSÉE. `0` est un point réel (golfe de Guinée) — jamais falsy. */
const pose = (v) => v != null && Number.isFinite(v);

/**
 * Le point depuis lequel on mesure, ou `null` s'il n'y en a aucun.
 *
 * Ordre : l'ancre EXPLICITE (Passeport) l'emporte sur ma position. Une ancre à
 * moitié écrite (une seule des deux coordonnées) n'est pas une ancre : on
 * retombe sur ma position plutôt que de mesurer depuis un point imaginaire.
 */
function ancrePour(prefs, moi) {
  if (pose(prefs?.search_anchor_lat) && pose(prefs?.search_anchor_lng)) {
    return { lat: prefs.search_anchor_lat, lng: prefs.search_anchor_lng, source: 'passeport' };
  }
  if (pose(moi?.current_lat) && pose(moi?.current_lng)) {
    return { lat: moi.current_lat, lng: moi.current_lng, source: 'moi' };
  }
  return null;
}

/**
 * Le rayon va-t-il RÉELLEMENT filtrer ? C'est la question que l'app pose pour
 * décider d'afficher le contrôle — et que le serveur pose pour l'appliquer.
 *
 * Ancré sur MOI, chercher dans un autre pays rend la mesure absurde (personne
 * n'est à 50 km de chez moi en France quand j'habite Douala) : on reste alors à
 * l'échelle du pays. Avec un Passeport, l'objection tombe — l'ancre EST le lieu.
 */
function rayonApplicable(prefs, moi) {
  const km = prefs?.search_radius_km;
  if (!pose(km) || km <= 0) return false;

  const ancre = ancrePour(prefs, moi);
  if (!ancre) return false;
  if (ancre.source === 'passeport') return true;

  return !prefs?.search_country || prefs.search_country === moi?.current_country;
}

/** Distance orthodromique en km (haversine). */
function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return RAYON_TERRE_KM * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Ce point est-il dans le rayon ? Frontière INCLUSIVE : quelqu'un pile à 50 km
 * d'un rayon de 50 km reste visible — exclure sur une égalité de flottants
 * serait arbitraire.
 */
function dansLeRayon(ancre, point, km) {
  if (!ancre || !pose(point?.lat) || !pose(point?.lng)) return false;
  return distanceKm(ancre, point) <= km;
}

/**
 * Faut-il ignorer le rayon parce qu'il ne laisse plus personne ?
 *
 * Le filet des apps de référence (Tinder : « montrer des personnes légèrement
 * hors de ma zone »). Il compte DOUBLE ici : sur un pool réduit, un rayon serré
 * vide la file, et on croit l'app morte alors qu'on s'est enfermé soi-même.
 * Jamais automatique — c'est un choix explicite, sinon le rayon ne voudrait
 * plus rien dire.
 */
function elargissementRequis(nbDansLeRayon, prefs) {
  if (!prefs?.expand_if_empty) return false;
  return nbDansLeRayon < MIN_PROFILS_AVANT_ELARGISSEMENT;
}

module.exports = {
  ancrePour,
  rayonApplicable,
  dansLeRayon,
  distanceKm,
  elargissementRequis,
  MIN_PROFILS_AVANT_ELARGISSEMENT,
};
