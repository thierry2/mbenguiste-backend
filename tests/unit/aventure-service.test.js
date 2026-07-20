'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SERVICE D'AVENTURE — orchestration SERVEUR AUTORITAIRE (I/O injecté).
//
// Une réponse arrive → on l'enregistre. Tant que l'autre n'a pas répondu, on
// ATTEND (rien ne bouge). Quand les DEUX ont répondu, le serveur résout et fait
// avancer la session — c'est ce que les deux clients verront via Realtime.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { soumettreReponse } = require('../../src/services/aventure.service');
const { graphe } = require('../../src/domain/aventureGraphe');

function deps(over = {}) {
  const journal = { avance: [], answers: [], clos: [] };
  const base = {
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n2',
      jokerUsed: false, toursDesaccord: 0, outcome: null,
    }),
    roleOf: async () => 'a',
    recordAnswer: async (r) => { journal.answers.push(r); },
    // par défaut : l'autre (b) a DÉJÀ répondu → les deux sont là
    answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 0 }),
    graphe,
    advanceSession: async (id, patch) => { journal.avance.push(patch); },
    clore: async (pairId, issue) => { journal.clos.push({ pairId, issue }); },
    _journal: () => journal,
  };
  return { ...base, ...over };
}

test('non membre → refusé, rien enregistré', async () => {
  const d = deps({ roleOf: async () => null });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'X', answerIndex: 0 });
  assert.equal(r.error, 'not-member');
  assert.equal(d._journal().answers.length, 0);
});

test('un seul a répondu → on ATTEND (rien n’avance)', async () => {
  const d = deps({ answersForNode: async () => ({ aRepondu: true, bRepondu: false, a: 0, b: null }) });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.waiting, true);
  assert.equal(d._journal().avance.length, 0);
});

test('les DEUX d’accord → survie, la session avance au nœud suivant', async () => {
  const d = deps(); // b déjà répondu (0,0) sur n2
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.resolved, true);
  assert.equal(r.next, 'n3');
  assert.equal(d._journal().avance[0].currentNode, 'n3');
  assert.equal(d._journal().avance[0].toursDesaccord, 0);
});

test('DÉSACCORD → on reste sur le nœud, tour incrémenté (on rejoue)', async () => {
  const d = deps({ answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }) });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.issue, 'boucle');
  assert.equal(d._journal().avance[0].currentNode, 'n2'); // même nœud
  assert.equal(d._journal().avance[0].toursDesaccord, 1);
});

test('VICTOIRE (n7 + Joker) → outcome match ET création du match', async () => {
  const d = deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n7',
      jokerUsed: true, toursDesaccord: 0, outcome: null,
    }),
  });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.outcome, 'match');
  assert.equal(d._journal().avance[0].outcome, 'match');
  assert.deepEqual(d._journal().clos, [{ pairId: 'P', issue: 'match' }]);
});

test('ÉCHEC (n7 sans Joker) → outcome echec, mais la paire N’EST PAS close (Joker possible)', async () => {
  const d = deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n7',
      jokerUsed: false, toursDesaccord: 0, outcome: null,
    }),
  });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.outcome, 'echec');
  // On NE clôt PAS : le Joker doit pouvoir rejouer la dernière épreuve.
  assert.deepEqual(d._journal().clos, []);
});

test('SORTIE PROPRE (consentement refusé) → outcome left, paire close sans match', async () => {
  const d = deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n4b',
      jokerUsed: false, toursDesaccord: 0, outcome: null,
    }),
    answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }), // un « on s'arrête »
  });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 1 });
  assert.equal(r.outcome, 'left');
  assert.deepEqual(d._journal().clos, [{ pairId: 'P', issue: 'left' }]);
});
