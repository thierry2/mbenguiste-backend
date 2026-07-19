'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// requirePartner — rattachement de secours.
//
// Cas réel (19/07) : la 1re invitation n'a pas pu envoyer son email, mais
// Supabase avait DÉJÀ créé le compte. La fiche partenaire est restée sans
// auth_user_id → son propriétaire, pourtant connecté, recevait 403 en boucle.
// On vérifie ici qu'un compte dont l'email correspond à une fiche NON reliée est
// rattaché une fois pour toutes — et qu'on ne détourne jamais une fiche déjà liée.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODEL = path.join(__dirname, '..', '..', 'src', 'models', 'partners.model.js');
const { requirePartner } = require('../../src/middlewares/auth.middleware');

/** Remplace le modèle dans le cache de require, le temps d'un test. */
function withModel(fake, fn) {
  const key = require.resolve(MODEL);
  const avant = require.cache[key];
  require.cache[key] = { id: key, filename: key, loaded: true, exports: fake };
  return Promise.resolve(fn()).finally(() => {
    if (avant) require.cache[key] = avant; else delete require.cache[key];
  });
}

function run(fake, user) {
  return withModel(fake, function () {
    return new Promise(function (resolve) {
      const req = { user: user, ip: '127.0.0.1', headers: {} };
      requirePartner(req, {}, function (err) { resolve({ req: req, err: err }); });
    });
  });
}

const PARTENAIRE = { id: 'part-1', displayName: 'Aminata', email: 'a@ex.com', status: 'active' };

test('compte déjà relié → passe directement', async () => {
  const { req, err } = await run({
    async findByAuthUser() { return PARTENAIRE; },
    async findByEmail() { throw new Error('ne doit pas être appelé'); },
    async attachAuthUser() { throw new Error('ne doit pas être appelé'); },
  }, { id: 'auth-1', email: 'a@ex.com' });
  assert.equal(err, undefined);
  assert.equal(req.partner.id, 'part-1');
});

test('fiche NON reliée + même email → rattachée automatiquement, accès accordé', async () => {
  const liaisons = [];
  const { req, err } = await run({
    async findByAuthUser() { return null; },
    async findByEmail() { return Object.assign({}, PARTENAIRE, { authUserId: null }); },
    async attachAuthUser(id, authId) { liaisons.push({ id, authId }); },
  }, { id: 'auth-1', email: 'a@ex.com' });

  assert.equal(err, undefined, 'ne doit plus être refusé');
  assert.equal(req.partner.id, 'part-1');
  assert.deepEqual(liaisons, [{ id: 'part-1', authId: 'auth-1' }], 'la liaison doit être écrite une fois');
});

test('fiche DÉJÀ reliée à un AUTRE compte → refusée (pas de détournement)', async () => {
  const liaisons = [];
  const { err } = await run({
    async findByAuthUser() { return null; },
    async findByEmail() { return Object.assign({}, PARTENAIRE, { authUserId: 'auth-DEJA-PRIS' }); },
    async attachAuthUser(id, authId) { liaisons.push({ id, authId }); },
  }, { id: 'auth-intrus', email: 'a@ex.com' });

  assert.ok(err, 'doit être refusé');
  assert.equal(err.statusCode, 403);
  assert.equal(liaisons.length, 0, 'aucune liaison ne doit être écrite');
});

test('aucune fiche pour cet email → refusé', async () => {
  const { err } = await run({
    async findByAuthUser() { return null; },
    async findByEmail() { return null; },
    async attachAuthUser() {},
  }, { id: 'auth-9', email: 'inconnu@ex.com' });
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('partenaire gelé → refusé même s\'il est relié', async () => {
  const { err } = await run({
    async findByAuthUser() { return Object.assign({}, PARTENAIRE, { status: 'frozen' }); },
    async findByEmail() { return null; },
    async attachAuthUser() {},
  }, { id: 'auth-1', email: 'a@ex.com' });
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});
