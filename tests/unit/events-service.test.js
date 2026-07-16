'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// events.service — l'entonnoir de la télémétrie. Le zod de la route borne déjà
// les formes (kinds, uuid, batch ≤ 50) ; le service applique ce que le schéma ne
// sait pas dire : pas d'auto-mesure (self-target jeté en silence), dwell clampé,
// payload borné en taille (2 Ko). La télémétrie n'est JAMAIS bloquante : on
// nettoie sans lever, on ne dérange pas le client pour des miettes.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEventsService } = require('../../src/services/events.service');

function fakeEventsModel() {
  return {
    calls: [],
    async ingest(viewerId, events) {
      this.calls.push({ viewerId, events });
      return events.length; // le RPC renvoie le nombre accepté
    },
  };
}

function makeService() {
  const events = fakeEventsModel();
  const service = createEventsService({ events });
  return { service, events };
}

const ev = (over = {}) => ({
  kind: 'card_impression', targetId: 't1', clientRef: 'ref-1', dwellMs: 1000, payload: {}, ...over,
});

test('batch propre : délégué au modèle tel quel, renvoie { accepted }', async () => {
  const { service, events } = makeService();
  const res = await service.ingest('u1', [
    ev({ clientRef: 'r1' }),
    ev({ kind: 'profile_open', clientRef: 'r2', dwellMs: undefined, payload: { src: 'discover' } }),
  ]);
  assert.deepEqual(res, { accepted: 2 });
  assert.equal(events.calls.length, 1);
  assert.equal(events.calls[0].viewerId, 'u1');
  assert.equal(events.calls[0].events.length, 2);
});

test('self-target : jeté EN SILENCE (pas d\'erreur, le reste du batch passe)', async () => {
  const { service, events } = makeService();
  const res = await service.ingest('u1', [
    ev({ targetId: 'u1', clientRef: 'r1' }), // s'auto-mesure → poubelle
    ev({ targetId: 't2', clientRef: 'r2' }),
  ]);
  assert.deepEqual(res, { accepted: 1 });
  assert.equal(events.calls[0].events.length, 1);
  assert.equal(events.calls[0].events[0].targetId, 't2');
});

test('batch vide après nettoyage : { accepted: 0 } SANS toucher le modèle', async () => {
  const { service, events } = makeService();
  const res = await service.ingest('u1', [ev({ targetId: 'u1' })]);
  assert.deepEqual(res, { accepted: 0 });
  assert.equal(events.calls.length, 0, 'pas d\'aller-retour DB pour rien');
});

test('dwellMs : clampé dans [0, 30 min] et arrondi à l\'entier', async () => {
  const { service, events } = makeService();
  await service.ingest('u1', [
    ev({ clientRef: 'r1', dwellMs: -50 }),          // impossible → 0
    ev({ clientRef: 'r2', dwellMs: 99_999_999 }),    // app oubliée ouverte → plafond
    ev({ clientRef: 'r3', dwellMs: 1234.7 }),        // float → entier
  ]);
  const sent = events.calls[0].events;
  assert.equal(sent[0].dwellMs, 0);
  assert.equal(sent[1].dwellMs, 1_800_000);
  assert.equal(sent[2].dwellMs, 1235);
});

test('dwellMs absent : reste absent (null en base, pas un faux 0)', async () => {
  const { service, events } = makeService();
  await service.ingest('u1', [ev({ kind: 'profile_open', dwellMs: undefined })]);
  assert.equal(events.calls[0].events[0].dwellMs, null);
});

test('payload obèse (> 2 Ko) : remplacé par {} — l\'événement survit, pas son bagage', async () => {
  const { service, events } = makeService();
  await service.ingest('u1', [
    ev({ clientRef: 'r1', payload: { notes: 'x'.repeat(5000) } }),
    ev({ clientRef: 'r2', payload: { photosViewed: 3 } }),
  ]);
  const sent = events.calls[0].events;
  assert.deepEqual(sent[0].payload, {});
  assert.deepEqual(sent[1].payload, { photosViewed: 3 });
});

test('payload absent : normalisé en {}', async () => {
  const { service, events } = makeService();
  await service.ingest('u1', [ev({ payload: undefined })]);
  assert.deepEqual(events.calls[0].events[0].payload, {});
});
