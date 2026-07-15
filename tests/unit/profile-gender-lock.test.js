'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Verrou d'édition du genre (doctrine §3, garde-fou de la gratuité femmes) :
// le genre se pose UNE fois (onboarding) puis devient immuable — sinon un
// homme se déclare femme pour la gratuité. Testé sur le service profil.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProfileService } = require('../../src/services/profile.service');

function makeService({ currentGenre = null } = {}) {
  const updates = [];
  const profiles = {
    async findById() { return { id: 'u1', genre: currentGenre }; },
    async update(id, u) { updates.push({ id, ...u }); return { id, genre: u.genreId ?? currentGenre }; },
    ageFromBirthDate: () => 30,
    async setInterests() {}, async setPrompts() {},
  };
  const idForCode = async (table, code) => `${table}:${code}`;
  const service = createProfileService({ profiles, idForCode });
  return { service, updates };
}

test('premier réglage du genre (onboarding) : autorisé', async () => {
  const { service, updates } = makeService({ currentGenre: null });
  await service.updateProfile('u1', { genre: 'woman' });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].genreId, 'genders:woman');
});

test('re-poser la MÊME valeur : toléré (no-op idempotent, pas d\'erreur au re-submit)', async () => {
  const { service } = makeService({ currentGenre: 'woman' });
  await assert.doesNotReject(() => service.updateProfile('u1', { genre: 'woman' }));
});

test('CHANGER le genre une fois posé : refusé (403)', async () => {
  const { service, updates } = makeService({ currentGenre: 'man' });
  await assert.rejects(
    () => service.updateProfile('u1', { genre: 'woman' }),
    (err) => {
      assert.equal(err.statusCode, 403);
      return true;
    },
  );
  assert.equal(updates.length, 0, 'rien n\'a été écrit');
});

test('effacer le genre (null) une fois posé : refusé aussi', async () => {
  const { service } = makeService({ currentGenre: 'woman' });
  await assert.rejects(
    () => service.updateProfile('u1', { genre: null }),
    (err) => err.statusCode === 403,
  );
});

test('mise à jour SANS toucher au genre : passe normalement', async () => {
  const { service, updates } = makeService({ currentGenre: 'woman' });
  await service.updateProfile('u1', { bio: 'Nouvelle bio' });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].bio, 'Nouvelle bio');
});
