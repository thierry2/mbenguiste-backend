'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LES NOTIFICATIONS DE TOUR — « on a besoin de toi ».
//
// C'est un JEU À DEUX EN ASYNCHRONE : entre deux étapes, l'un attend l'autre,
// parfois des heures. Sans push, la seule façon de savoir que son binôme a joué
// était d'ouvrir l'onglet au hasard — et l'aventure mourait d'attente. Le
// service n'envoyait AUCUNE notification (audit 21/07) : ni « à toi de jouer »,
// ni « c'est gagné ».
//
// QUATRE EXIGENCES, toutes vérifiées ici :
//   1. On prévient CELUI QUI DOIT JOUER, jamais celui qui vient de jouer.
//   2. On ne prévient QUE quand quelque chose a bougé pour lui : ma réponse en
//      attente ne le concerne pas encore (il n'a rien de neuf à voir), c'est la
//      RÉSOLUTION qui lui rend la main.
//   3. ANONYMAT : une notification ne porte jamais d'identité (doctrine push).
//   4. BEST-EFFORT : un push qui explose ne casse JAMAIS l'aventure. C'est la
//      règle de tout le reste des notifications, et c'est la plus importante —
//      un service de push indisponible ne doit pas bloquer une partie.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { soumettreReponse } = require('../../src/services/aventure.service');
const { graphe } = require('../../src/domain/aventureGraphe');

const MOI = 'U-moi';
const AUTRE = 'U-autre';

function deps(over = {}) {
  const journal = { avance: [], clos: [], notifs: [] };
  const base = {
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n2',
      jokerUsed: false, toursDesaccord: 0, outcome: null,
    }),
    roleOf: async () => 'a',
    membresDePaire: async () => [MOI, AUTRE],
    recordAnswer: async () => {},
    answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 0 }),
    graphe,
    advanceSession: async (id, patch) => { journal.avance.push(patch); },
    clore: async (pairId, issue) => { journal.clos.push({ pairId, issue }); },
    notifier: async (userId, type) => { journal.notifs.push({ userId, type }); },
    _journal: () => journal,
  };
  return { ...base, ...over };
}

describe('on prévient celui qui doit jouer', () => {
  test('l’étape se résout → l’AUTRE est prévenu qu’on l’attend', async () => {
    const d = deps();
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.deepEqual(d._journal().notifs, [{ userId: AUTRE, type: 'mystere_turn' }]);
  });

  test('celui qui vient de jouer n’est JAMAIS notifié (il est devant son écran)', async () => {
    const d = deps();
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.equal(d._journal().notifs.some((n) => n.userId === MOI), false);
  });

  test('j’ai répondu le PREMIER → personne n’est notifié (rien de neuf à voir)', async () => {
    // Le partenaire n'a pas encore répondu : il a déjà été prévenu à l'étape
    // précédente, le re-notifier serait du bruit pur.
    const d = deps({ answersForNode: async () => ({ aRepondu: true, bRepondu: false, a: 0, b: null }) });
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.deepEqual(d._journal().notifs, []);
  });

  test('DÉSACCORD → l’autre est prévenu aussi : la question se rejoue, on l’attend', async () => {
    const d = deps({ answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }) });
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.deepEqual(d._journal().notifs, [{ userId: AUTRE, type: 'mystere_turn' }]);
  });
});

describe('les fins portent leur propre message', () => {
  test('VICTOIRE → l’autre reçoit la révélation, pas un « à toi de jouer »', async () => {
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n7',
        jokerUsed: true, toursDesaccord: 0, outcome: null,
      }),
    });
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.deepEqual(d._journal().notifs, [{ userId: AUTRE, type: 'mystere_reveal' }]);
  });

  test('SORTIE PROPRE (consentement refusé) → l’autre apprend que c’est fini', async () => {
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n4b',
        jokerUsed: false, toursDesaccord: 0, outcome: null,
      }),
      answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }),
    });
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 1 });
    assert.deepEqual(d._journal().notifs, [{ userId: AUTRE, type: 'mystere_ended' }]);
  });

  test('ÉCHEC → « à toi de jouer » : la paire vit encore, le Joker peut rejouer', async () => {
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n7',
        jokerUsed: false, toursDesaccord: 0, outcome: null,
      }),
    });
    await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.deepEqual(d._journal().notifs, [{ userId: AUTRE, type: 'mystere_turn' }]);
  });
});

describe('la notification ne peut jamais casser l’aventure', () => {
  test('un push qui EXPLOSE laisse la session avancer normalement', async () => {
    const d = deps({ notifier: async () => { throw new Error('expo down'); } });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.equal(r.resolved, true);
    assert.equal(r.next, 'n3');
    assert.equal(d._journal().avance.length, 1);
  });

  test('membres introuvables → on n’invente personne, l’aventure continue', async () => {
    const d = deps({ membresDePaire: async () => null });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.equal(r.resolved, true);
    assert.deepEqual(d._journal().notifs, []);
  });

  test('sans `notifier` injecté (ancien câblage) → aucune erreur', async () => {
    const d = deps({ notifier: undefined });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: MOI, answerIndex: 0 });
    assert.equal(r.resolved, true);
  });
});
