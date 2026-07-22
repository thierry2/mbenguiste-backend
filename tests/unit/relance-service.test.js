'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE JOB DE RELANCE — orchestration (I/O injecté).
//
// Ce qui se joue ici n'est pas « est-ce qu'on relance » (le domaine le dit, cf.
// aventure-relance.test.js) mais « est-ce qu'on relance UNE SEULE FOIS, la BONNE
// personne, et sans qu'un incident n'emporte tout le reste ».
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { passerRelances } = require('../../src/services/relance.service');
const { RELANCE_APRES_MS } = require('../../src/domain/aventureRelance');

const T0 = Date.parse('2026-07-22T12:00:00.000Z');
const vieux = new Date(T0 - RELANCE_APRES_MS - 1000).toISOString();

function deps(over = {}) {
  const journal = { marquees: [], notifs: [] };
  const base = {
    attentesARelancer: async () => ([
      { sessionId: 'S1', pairId: 'P1', role: 'a', repondUAt: vieux },
    ]),
    marquerRelance: async (id) => { journal.marquees.push(id); },
    membresDePaire: async () => ['U-A', 'U-B'],
    // 'a' = U-A, 'b' = U-B (convention `roleDe` : low/high)
    roleOf: async (_pairId, uid) => (uid === 'U-A' ? 'a' : 'b'),
    notifier: async (uid, type) => { journal.notifs.push({ uid, type }); },
    _journal: () => journal,
  };
  return { ...base, ...over };
}

describe('passerRelances — une fois, à la bonne personne', () => {
  test('relance CELUI QUI N’A PAS RÉPONDU', async () => {
    const d = deps();
    const n = await passerRelances(d, { maintenant: T0 });
    assert.equal(n, 1);
    assert.deepEqual(d._journal().notifs, [{ uid: 'U-B', type: 'mystere_relance' }]);
  });

  test('jamais celui qui a déjà joué', async () => {
    const d = deps();
    await passerRelances(d, { maintenant: T0 });
    assert.equal(d._journal().notifs.some((x) => x.uid === 'U-A'), false);
  });

  test('MARQUE le tour — c’est ce qui rend la relance unique', async () => {
    const d = deps();
    await passerRelances(d, { maintenant: T0 });
    assert.deepEqual(d._journal().marquees, ['S1']);
  });

  test('un push qui ÉCHOUE laisse quand même le tour marqué', async () => {
    // Sinon on réessaierait à CHAQUE tick : une relance par minute, soit
    // exactement le harcèlement qu'on veut éviter.
    const d = deps({ notifier: async () => { throw new Error('push mort'); } });
    await passerRelances(d, { maintenant: T0 });
    assert.deepEqual(d._journal().marquees, ['S1']);
  });

  test('une session en échec n’emporte PAS les autres', async () => {
    const d = deps({
      attentesARelancer: async () => ([
        { sessionId: 'S1', pairId: 'P1', role: 'a', repondUAt: vieux },
        { sessionId: 'S2', pairId: 'P2', role: 'a', repondUAt: vieux },
      ]),
      membresDePaire: async (pairId) => {
        if (pairId === 'P1') throw new Error('paire illisible');
        return ['U-A', 'U-B'];
      },
    });
    const n = await passerRelances(d, { maintenant: T0 });
    assert.equal(n, 1, 'S2 est bien relancée malgré l’échec de S1');
  });

  test('paire incomplète → on ne relance pas dans le vide', async () => {
    const d = deps({ membresDePaire: async () => ['U-A'] });
    const n = await passerRelances(d, { maintenant: T0 });
    assert.equal(n, 0);
    assert.deepEqual(d._journal().marquees, [], 'et on ne consomme pas le filet');
  });

  test('rien à relancer → aucun effet de bord', async () => {
    const d = deps({ attentesARelancer: async () => [] });
    const n = await passerRelances(d, { maintenant: T0 });
    assert.equal(n, 0);
    assert.deepEqual(d._journal().notifs, []);
  });
});
