'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LA RELANCE DOUCE — qui rappeler, et surtout qui NE PAS rappeler.
//
// Une aventure s'endort quand l'un a répondu et que l'autre ne revient pas. Le
// binôme a été prévenu une fois ; si la notification a été balayée, plus rien ne
// le lui redit et la partie meurt en silence.
//
// La ligne à ne pas franchir : UNE relance par tour. Insister au-delà, c'est du
// harcèlement — et c'est ce qui fait désinstaller une app de rencontre.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sessionsARelancer, RELANCE_APRES_MS } = require('../../src/domain/aventureRelance');

const T0 = Date.parse('2026-07-22T12:00:00.000Z');
const ilYA = (ms) => new Date(T0 - ms).toISOString();
const ligne = (over = {}) => ({
  sessionId: 'S1', pairId: 'P1', role: 'a', repondUAt: ilYA(RELANCE_APRES_MS + 1000), ...over,
});

describe('sessionsARelancer — le filet, pas le harcèlement', () => {
  test('un seul a répondu depuis longtemps → on relance L’AUTRE', () => {
    const r = sessionsARelancer({ lignes: [ligne()], maintenant: T0 });
    assert.deepEqual(r, [{
      sessionId: 'S1', pairId: 'P1', roleQuiAttend: 'a', roleARelancer: 'b',
    }]);
  });

  test('jamais celui qui a DÉJÀ répondu — il n’a rien à faire de plus', () => {
    const r = sessionsARelancer({ lignes: [ligne({ role: 'b' })], maintenant: T0 });
    assert.equal(r[0].roleARelancer, 'a');
  });

  test('trop tôt → on ne relance pas (on ne talonne personne)', () => {
    const r = sessionsARelancer({
      lignes: [ligne({ repondUAt: ilYA(RELANCE_APRES_MS - 1000) })], maintenant: T0,
    });
    assert.deepEqual(r, []);
  });

  test('LES DEUX ont répondu → rien : l’attente n’existe plus', () => {
    // Le serveur a résolu (ou va le faire). Relancer annoncerait une attente
    // qui n'est plus vraie — le pire message qu'on puisse envoyer.
    const r = sessionsARelancer({
      lignes: [ligne({ role: 'a' }), ligne({ role: 'b' })], maintenant: T0,
    });
    assert.deepEqual(r, []);
  });

  test('AUCUNE réponse → rien : personne n’attend personne', () => {
    assert.deepEqual(sessionsARelancer({ lignes: [], maintenant: T0 }), []);
  });

  test('plusieurs sessions sont traitées indépendamment', () => {
    const r = sessionsARelancer({
      lignes: [
        ligne({ sessionId: 'S1', pairId: 'P1', role: 'a' }),
        ligne({ sessionId: 'S2', pairId: 'P2', role: 'b' }),
        // S3 : les deux ont répondu → écartée
        ligne({ sessionId: 'S3', pairId: 'P3', role: 'a' }),
        ligne({ sessionId: 'S3', pairId: 'P3', role: 'b' }),
      ],
      maintenant: T0,
    });
    assert.deepEqual(r.map((x) => x.sessionId).sort(), ['S1', 'S2']);
    assert.equal(r.find((x) => x.sessionId === 'S2').roleARelancer, 'a');
  });

  test('horodatage illisible → on ne relance pas', () => {
    // Mieux vaut une relance qui n'arrive pas qu'une relance envoyée sur une
    // donnée qu'on ne comprend pas.
    for (const t of [null, undefined, '', 'hier', 42]) {
      assert.deepEqual(sessionsARelancer({ lignes: [ligne({ repondUAt: t })], maintenant: T0 }), []);
    }
  });

  test('lignes corrompues (nulles, rôle inconnu) → ignorées sans exception', () => {
    const r = sessionsARelancer({
      lignes: [null, undefined, ligne({ role: 'c' }), ligne({ sessionId: null }), ligne()],
      maintenant: T0,
    });
    assert.equal(r.length, 1);
  });

  test('entrée non-tableau → tableau vide, jamais d’exception', () => {
    for (const l of [null, undefined, 'x', 42, {}]) {
      assert.deepEqual(sessionsARelancer({ lignes: l, maintenant: T0 }), []);
    }
  });

  test('le seuil est CONFIGURABLE (on pourra l’ajuster sans toucher aux règles)', () => {
    const r = sessionsARelancer({
      lignes: [ligne({ repondUAt: ilYA(60_000) })], maintenant: T0, apresMs: 30_000,
    });
    assert.equal(r.length, 1);
  });
});
