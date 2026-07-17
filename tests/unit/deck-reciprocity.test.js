'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Réciprocité du deck (spec 16/07) : un candidat n'entre dans MA pile que si
// SES préférences m'acceptent — genre (il cherche mon genre, ou « peu
// importe ») et âge (mon âge dans sa tranche). Filtre DUR, symétrique de celui
// que j'applique. Doctrine de tolérance : l'inconnu LAISSE PASSER (pas de ligne
// de préférences, borne absente, mon genre/âge non renseigné) — on ne punit
// jamais un profil inachevé, on ne filtre que sur du certain.
// Cas réel qui a motivé le filtre : un homme cherchant des femmes apparaissait
// dans le deck d'un homme cherchant des hommes — like à fonds perdus.
// Fonction PURE (zéro I/O).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acceptsMe } = require('../../src/domain/deck');

const HOMME = 'gender-homme';
const FEMME = 'gender-femme';

// ── Genre ────────────────────────────────────────────────────────────────────

test('il cherche mon genre → passe ; il cherche un autre genre → exclu', () => {
  assert.equal(acceptsMe({ seeking_gender_id: HOMME }, { myGenderId: HOMME, myAge: 30 }), true);
  assert.equal(acceptsMe({ seeking_gender_id: FEMME }, { myGenderId: HOMME, myAge: 30 }), false);
});

test('cas réel : homme-cherchant-femmes EXCLU du deck d\'un homme (plus de like à fonds perdus)', () => {
  // Kwame (cherche des femmes) ne doit plus apparaître chez un viewer homme.
  assert.equal(acceptsMe({ seeking_gender_id: FEMME, min_age: 22, max_age: 45 },
    { myGenderId: HOMME, myAge: 30 }), false);
});

test('« peu importe » (seeking null) → passe', () => {
  assert.equal(acceptsMe({ seeking_gender_id: null }, { myGenderId: HOMME, myAge: 30 }), true);
});

test('mon genre inconnu → on ne peut pas juger → passe', () => {
  assert.equal(acceptsMe({ seeking_gender_id: FEMME }, { myGenderId: null, myAge: 30 }), true);
});

// ── Âge ──────────────────────────────────────────────────────────────────────

test('mon âge dans sa tranche → passe ; en dehors → exclu (les deux bornes)', () => {
  const prefs = { seeking_gender_id: null, min_age: 25, max_age: 40 };
  assert.equal(acceptsMe(prefs, { myGenderId: HOMME, myAge: 30 }), true);
  assert.equal(acceptsMe(prefs, { myGenderId: HOMME, myAge: 25 }), true, 'bornes incluses');
  assert.equal(acceptsMe(prefs, { myGenderId: HOMME, myAge: 40 }), true, 'bornes incluses');
  assert.equal(acceptsMe(prefs, { myGenderId: HOMME, myAge: 24 }), false, 'trop jeune pour elle');
  assert.equal(acceptsMe(prefs, { myGenderId: HOMME, myAge: 41 }), false, 'trop vieux pour elle');
});

test('bornes absentes ou mon âge inconnu → passe', () => {
  assert.equal(acceptsMe({ min_age: null, max_age: null }, { myGenderId: HOMME, myAge: 99 }), true);
  assert.equal(acceptsMe({ min_age: 25, max_age: 40 }, { myGenderId: HOMME, myAge: null }), true);
});

// ── Tolérance ────────────────────────────────────────────────────────────────

test('candidat SANS ligne de préférences → passe (profil inachevé, pas exclu)', () => {
  assert.equal(acceptsMe(null, { myGenderId: HOMME, myAge: 30 }), true);
  assert.equal(acceptsMe(undefined, { myGenderId: HOMME, myAge: 30 }), true);
});

test('les deux critères se cumulent : bon genre mais mauvais âge → exclu', () => {
  assert.equal(acceptsMe({ seeking_gender_id: HOMME, min_age: 20, max_age: 25 },
    { myGenderId: HOMME, myAge: 30 }), false);
});
