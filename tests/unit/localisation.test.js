'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ancrePour,
  rayonApplicable,
  dansLeRayon,
  distanceKm,
  elargissementRequis,
  MIN_PROFILS_AVANT_ELARGISSEMENT,
} = require('../../src/domain/localisation');

// Repères réels — Douala et Yaoundé sont à ~200 km l'une de l'autre.
const DOUALA = { lat: 4.05, lng: 9.70 };
const YAOUNDE = { lat: 3.87, lng: 11.52 };
const PARIS = { lat: 48.85, lng: 2.35 };

const moiA = (c, pays = 'CM') => ({ current_lat: c.lat, current_lng: c.lng, current_country: pays });

// ── ancrePour : d'où mesure-t-on ? ───────────────────────────────────────────

test('ancre : le Passeport prime sur ma position', () => {
  const a = ancrePour(
    { search_anchor_lat: PARIS.lat, search_anchor_lng: PARIS.lng },
    moiA(DOUALA),
  );
  assert.equal(a.source, 'passeport');
  assert.equal(a.lat, PARIS.lat);
});

test('ancre : un Passeport À MOITIÉ écrit est ignoré (lat sans lng)', () => {
  const a = ancrePour({ search_anchor_lat: PARIS.lat, search_anchor_lng: null }, moiA(DOUALA));
  assert.equal(a.source, 'moi', 'une ancre incomplète ne doit jamais servir de repère');
});

test('ancre : un Passeport à moitié écrit est ignoré (lng sans lat)', () => {
  const a = ancrePour({ search_anchor_lat: null, search_anchor_lng: PARIS.lng }, moiA(DOUALA));
  assert.equal(a.source, 'moi');
});

test('ancre : sans Passeport, on mesure depuis ma position', () => {
  const a = ancrePour({}, moiA(DOUALA));
  assert.deepEqual({ lat: a.lat, lng: a.lng, source: a.source }, { ...DOUALA, source: 'moi' });
});

test('ancre : aucune position et aucun Passeport → null', () => {
  assert.equal(ancrePour({}, { current_lat: null, current_lng: null }), null);
});

test('ancre : `moi` absent → null (défensif)', () => {
  assert.equal(ancrePour({}, null), null);
  assert.equal(ancrePour({}, undefined), null);
});

test('ancre : prefs absentes → on retombe sur ma position', () => {
  assert.equal(ancrePour(null, moiA(DOUALA)).source, 'moi');
});

// LE PIÈGE : (0,0) est un VRAI point (golfe de Guinée, juste au sud du Cameroun).
// Un test de vérité (`if (lat)`) l'écarterait à tort.
test('ancre : la coordonnée 0 est valide, jamais traitée comme absente', () => {
  const a = ancrePour({}, { current_lat: 0, current_lng: 0, current_country: 'CM' });
  assert.notEqual(a, null, '(0,0) est un point réel, pas une absence de position');
  assert.equal(a.lat, 0);
});

test('ancre : un Passeport posé sur (0,0) reste un Passeport', () => {
  const a = ancrePour({ search_anchor_lat: 0, search_anchor_lng: 0 }, moiA(DOUALA));
  assert.equal(a.source, 'passeport');
});

// ── rayonApplicable : le rayon agit-il vraiment ? ────────────────────────────

test('rayon : sans rayon réglé, il ne s\'applique pas', () => {
  assert.equal(rayonApplicable({ search_radius_km: null }, moiA(DOUALA)), false);
});

test('rayon : un rayon de 0 km ne s\'applique pas', () => {
  assert.equal(rayonApplicable({ search_radius_km: 0 }, moiA(DOUALA)), false);
});

test('rayon : un rayon négatif ne s\'applique pas (défensif)', () => {
  assert.equal(rayonApplicable({ search_radius_km: -50 }, moiA(DOUALA)), false);
});

test('rayon : sans ancre, il ne s\'applique pas — c\'est le no-op silencieux d\'avant', () => {
  assert.equal(
    rayonApplicable({ search_radius_km: 50 }, { current_lat: null, current_lng: null }),
    false,
  );
});

test('rayon : ancré sur moi, sans pays choisi → s\'applique', () => {
  assert.equal(rayonApplicable({ search_radius_km: 50, search_country: null }, moiA(DOUALA)), true);
});

test('rayon : ancré sur moi, pays choisi == mon pays → s\'applique', () => {
  assert.equal(rayonApplicable({ search_radius_km: 50, search_country: 'CM' }, moiA(DOUALA, 'CM')), true);
});

test('rayon : ancré sur moi, pays ÉTRANGER → ne s\'applique pas (mesurer de chez moi n\'a pas de sens)', () => {
  assert.equal(rayonApplicable({ search_radius_km: 50, search_country: 'FR' }, moiA(DOUALA, 'CM')), false);
});

test('rayon : avec un Passeport, le pays étranger ne bloque PLUS — l\'ancre définit le lieu', () => {
  const prefs = {
    search_radius_km: 50,
    search_country: 'FR',
    search_anchor_lat: PARIS.lat,
    search_anchor_lng: PARIS.lng,
  };
  assert.equal(rayonApplicable(prefs, moiA(DOUALA, 'CM')), true);
});

test('rayon : Passeport sans pays choisi → s\'applique aussi', () => {
  const prefs = { search_radius_km: 50, search_anchor_lat: PARIS.lat, search_anchor_lng: PARIS.lng };
  assert.equal(rayonApplicable(prefs, moiA(DOUALA, 'CM')), true);
});

// ── dansLeRayon ──────────────────────────────────────────────────────────────

test('dansLeRayon : un profil sans coordonnées est exclu', () => {
  assert.equal(dansLeRayon(DOUALA, { lat: null, lng: null }, 50), false);
});

test('dansLeRayon : sans ancre, rien ne passe', () => {
  assert.equal(dansLeRayon(null, DOUALA, 50), false);
});

test('dansLeRayon : Yaoundé est hors d\'un rayon de 50 km autour de Douala', () => {
  assert.equal(dansLeRayon(DOUALA, YAOUNDE, 50), false);
});

test('dansLeRayon : Yaoundé est dans un rayon de 300 km autour de Douala', () => {
  assert.equal(dansLeRayon(DOUALA, YAOUNDE, 300), true);
});

test('dansLeRayon : la frontière est INCLUSIVE (distance exactement égale au rayon)', () => {
  const d = distanceKm(DOUALA, YAOUNDE);
  assert.equal(dansLeRayon(DOUALA, YAOUNDE, d), true, 'pile à la limite, on garde');
});

// ── distanceKm ───────────────────────────────────────────────────────────────

test('distance : un point avec lui-même vaut 0', () => {
  assert.equal(Math.round(distanceKm(DOUALA, DOUALA)), 0);
});

test('distance : Douala–Yaoundé ≈ 200 km', () => {
  const d = distanceKm(DOUALA, YAOUNDE);
  assert.ok(d > 190 && d < 215, `attendu ~200 km, obtenu ${d}`);
});

test('distance : symétrique', () => {
  assert.equal(
    Math.round(distanceKm(DOUALA, PARIS)),
    Math.round(distanceKm(PARIS, DOUALA)),
  );
});

// ── elargissementRequis : ne jamais laisser une file vide à cause du rayon ──

test('élargissement : option désactivée → jamais, même sans aucun profil', () => {
  assert.equal(elargissementRequis(0, { expand_if_empty: false }), false);
});

test('élargissement : option absente → jamais (défaut prudent)', () => {
  assert.equal(elargissementRequis(0, {}), false);
});

test('élargissement : option active et file vide → on élargit', () => {
  assert.equal(elargissementRequis(0, { expand_if_empty: true }), true);
});

test('élargissement : option active et trop peu de profils → on élargit', () => {
  assert.equal(
    elargissementRequis(MIN_PROFILS_AVANT_ELARGISSEMENT - 1, { expand_if_empty: true }),
    true,
  );
});

test('élargissement : pile au seuil → on n\'élargit pas', () => {
  assert.equal(
    elargissementRequis(MIN_PROFILS_AVANT_ELARGISSEMENT, { expand_if_empty: true }),
    false,
  );
});

test('élargissement : largement assez de profils → on n\'élargit pas', () => {
  assert.equal(elargissementRequis(100, { expand_if_empty: true }), false);
});
