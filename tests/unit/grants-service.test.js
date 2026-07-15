'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// grants.service — les avantages récurrents des paliers (5 Super Likes/sem,
// 1 Boost/mois pour Or+, 1 Joker/sem pour Prestige), octroyés PARESSEUSEMENT
// (à la lecture des droits, pas de cron) et IDEMPOTENTS par période : le
// registre (claim unique par profil × kind × période) garantit qu'aucun
// rafraîchissement d'écran ne crédite deux fois.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGrantsService } = require('../../src/services/grants.service');

const NOW = new Date('2026-07-15T12:00:00Z').getTime();      // mercredi, W29, juillet
const NEXT_WEEK = new Date('2026-07-20T12:00:00Z').getTime(); // lundi suivant, W30
const NEXT_MONTH = new Date('2026-08-03T12:00:00Z').getTime(); // août (W32)

function fakeGrantsModel() {
  const claimed = new Set();
  return {
    claimed,
    async claim(profileId, kind, key) {
      const k = `${profileId}:${kind}:${key}`;
      if (claimed.has(k)) return false;
      claimed.add(k);
      return true;
    },
    async release(profileId, kind, key) {
      claimed.delete(`${profileId}:${kind}:${key}`);
    },
  };
}

function fakeCreditsModel() {
  return {
    granted: [],
    async grant(profileId, amounts) {
      this.granted.push({ profileId, ...amounts });
    },
  };
}

function makeService() {
  const grantsModel = fakeGrantsModel();
  const creditsModel = fakeCreditsModel();
  const service = createGrantsService({ grantsModel, creditsModel });
  return { service, grantsModel, creditsModel };
}

const somme = (granted, champ) => granted.reduce((n, g) => n + (g[champ] ?? 0), 0);

// ── Qui reçoit quoi ──────────────────────────────────────────────────────────

test('free : aucun grant, le registre n\'est même pas touché', async () => {
  const { service, grantsModel, creditsModel } = makeService();
  await service.ensure('u1', 'free', false, NOW);
  assert.equal(creditsModel.granted.length, 0);
  assert.equal(grantsModel.claimed.size, 0);
});

test('plus : aucun grant (le palier ne porte que du confort)', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'plus', false, NOW);
  assert.equal(creditsModel.granted.length, 0);
});

test('or payé : +5 Super Likes (semaine) et +1 Boost (mois)', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', false, NOW);
  assert.equal(somme(creditsModel.granted, 'superLikes'), 5);
  assert.equal(somme(creditsModel.granted, 'boosts'), 1);
  assert.equal(somme(creditsModel.granted, 'jokers'), 0, 'le Joker est Prestige only');
});

test('or OFFERT (femme, flag on) : mêmes munitions que l\'Or payé', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', true, NOW);
  assert.equal(somme(creditsModel.granted, 'superLikes'), 5);
  assert.equal(somme(creditsModel.granted, 'boosts'), 1);
});

test('prestige : Or inclus + 1 Joker/semaine', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'prestige', false, NOW);
  assert.equal(somme(creditsModel.granted, 'superLikes'), 5);
  assert.equal(somme(creditsModel.granted, 'boosts'), 1);
  assert.equal(somme(creditsModel.granted, 'jokers'), 1);
});

// ── Idempotence par période ──────────────────────────────────────────────────

test('idempotence : rappeler ensure() dans la MÊME période ne re-crédite rien', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', false, NOW);
  await service.ensure('u1', 'or', false, NOW);
  await service.ensure('u1', 'or', false, NOW + 60_000); // une minute plus tard
  assert.equal(somme(creditsModel.granted, 'superLikes'), 5, 'un seul grant hebdo');
  assert.equal(somme(creditsModel.granted, 'boosts'), 1, 'un seul grant mensuel');
});

test('claim refusé (course entre deux requêtes) → aucun crédit versé', async () => {
  const grantsModel = { async claim() { return false; } }; // tout déjà réclamé
  const creditsModel = fakeCreditsModel();
  const service = createGrantsService({ grantsModel, creditsModel });
  await service.ensure('u1', 'prestige', false, NOW);
  assert.equal(creditsModel.granted.length, 0, 'claim=false → jamais de crédit (anti double-versement)');
});

// ── Renouvellement au changement de période ──────────────────────────────────

test('semaine suivante : les Super Likes hebdo retombent, pas le Boost mensuel', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', false, NOW);       // W29 + juillet
  await service.ensure('u1', 'or', false, NEXT_WEEK); // W30, toujours juillet
  assert.equal(somme(creditsModel.granted, 'superLikes'), 10, '5 + 5 (deux semaines)');
  assert.equal(somme(creditsModel.granted, 'boosts'), 1, 'juillet n\'a droit qu\'à un Boost');
});

test('mois suivant : le Boost retombe aussi', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', false, NOW);        // W29 + juillet
  await service.ensure('u1', 'or', false, NEXT_MONTH); // W32 + août
  assert.equal(somme(creditsModel.granted, 'boosts'), 2, 'juillet + août');
});

// ── Isolation entre utilisateurs ─────────────────────────────────────────────

test('deux utilisateurs : registres indépendants', async () => {
  const { service, creditsModel } = makeService();
  await service.ensure('u1', 'or', false, NOW);
  await service.ensure('u2', 'or', false, NOW);
  assert.equal(somme(creditsModel.granted, 'superLikes'), 10);
  const destinataires = new Set(creditsModel.granted.map((g) => g.profileId));
  assert.deepEqual([...destinataires].sort(), ['u1', 'u2']);
});

// ── Robustesse ───────────────────────────────────────────────────────────────

test('versement échoué : ensure ne lève pas, la réservation est RENDUE, le prochain appel réessaie', async () => {
  const grantsModel = fakeGrantsModel();
  let fois = 0;
  const granted = [];
  const creditsModel = {
    async grant(profileId, amounts) {
      fois += 1;
      if (fois <= 2) throw new Error('DB down'); // les 2 grants (hebdo+mensuel) échouent
      granted.push({ profileId, ...amounts });
    },
  };
  const service = createGrantsService({ grantsModel, creditsModel });

  // 1er passage : échec silencieux (fail-soft — les droits restent lisibles)…
  await assert.doesNotReject(() => service.ensure('u1', 'or', false, NOW));
  assert.equal(granted.length, 0);
  // …et la réservation a été rendue : le passage suivant re-crédite pour de vrai.
  await service.ensure('u1', 'or', false, NOW);
  assert.equal(somme(granted, 'superLikes'), 5, 'le grant hebdo a fini par passer');
  assert.equal(somme(granted, 'boosts'), 1, 'le grant mensuel aussi');
});
