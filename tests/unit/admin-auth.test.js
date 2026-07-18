'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin — la porte de la console de modération. Ce qu'elle protège n'est
// pas une liste de tickets : ce sont des récits d'agressions écrits par des
// femmes qui ont fait confiance à l'app. Elle doit être FERMÉE par défaut.
// ─────────────────────────────────────────────────────────────────────────────
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const CONFIG_PATH = require.resolve('../../src/config');
const MW_PATH = require.resolve('../../src/middlewares/auth.middleware');

/** Recharge le middleware avec une config admin donnée (le config est mis en cache). */
function withAdminConfig({ secret = '', allowedIps = [] }) {
  delete require.cache[CONFIG_PATH];
  delete require.cache[MW_PATH];
  const config = require('../../src/config');
  config.admin = { secret, allowedIps };
  return require('../../src/middlewares/auth.middleware').requireAdmin;
}

afterEach(() => {
  delete require.cache[CONFIG_PATH];
  delete require.cache[MW_PATH];
});

/** Appelle le middleware et rend l'erreur transmise à next(), ou null si passé. */
function run(requireAdmin, { header, ip = '1.2.3.4' }) {
  let captured = null;
  requireAdmin({ headers: header === undefined ? {} : { 'x-admin-secret': header }, ip },
    {}, (err) => { captured = err ?? null; });
  return captured;
}

test('sans ADMIN_SECRET configuré : TOUT est refusé, même une requête vide', () => {
  const mw = withAdminConfig({ secret: '' });
  assert.notEqual(run(mw, { header: undefined }), null);
  assert.notEqual(run(mw, { header: '' }), null);
});

test('mauvais secret : refusé', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long' });
  assert.notEqual(run(mw, { header: 'pas-le-bon-secret-x' }), null);
});

test('secret absent alors qu\'il en faut un : refusé', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long' });
  assert.notEqual(run(mw, { header: undefined }), null);
});

test('bon secret : laissé passer', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long' });
  assert.equal(run(mw, { header: 'le-vrai-secret-long' }), null);
});

test('un préfixe du bon secret ne passe pas (longueurs différentes)', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long' });
  assert.notEqual(run(mw, { header: 'le-vrai' }), null);
});

test('allowlist IP : une IP hors liste est refusée même avec le bon secret', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long', allowedIps: ['82.1.2.3'] });
  assert.notEqual(run(mw, { header: 'le-vrai-secret-long', ip: '9.9.9.9' }), null);
});

test('allowlist IP : l\'IP autorisée avec le bon secret passe', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long', allowedIps: ['82.1.2.3'] });
  assert.equal(run(mw, { header: 'le-vrai-secret-long', ip: '82.1.2.3' }), null);
});

test('allowlist IP : la bonne IP NE DISPENSE PAS du secret', () => {
  const mw = withAdminConfig({ secret: 'le-vrai-secret-long', allowedIps: ['82.1.2.3'] });
  assert.notEqual(run(mw, { header: 'mauvais', ip: '82.1.2.3' }), null);
});
