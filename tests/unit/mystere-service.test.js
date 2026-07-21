'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE JOB DE PASSE — orchestration PURE (I/O injecté), testée avec des fakes.
//
// Ce que la passe DOIT faire, et ce que ces tests figent :
//   · ne RIEN faire hors de la fenêtre de tirage ;
//   · ne pas repasser avant `pass_minutes` (throttle) ;
//   · dissoudre les propositions non commencées trop vieilles (auto-réparation) ;
//   · garder les aventures commencées hors du vivier (verrouillées) et ne JAMAIS
//     les réécrire ;
//   · n'écrire que les NOUVELLES paires ;
//   · appliquer le bon plancher (fenêtre / hors fenêtre).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runMysteryPass } = require('../../src/services/mystere.service');

const H = (h) => Date.UTC(2026, 6, 20, h, 0, 0);       // un instant UTC à l'heure h
const CFG = {
  heureTirageUtc: 21, fenetreMinutes: 120, pasMinutes: 10,
  plancherFenetre: 1, plancherHorsFenetre: 50, assortativeWeight: 0,
};

// Un vivier de test : score = intérêts partagés × 3 (comme le score réel injecté).
const scoreTest = (v, c) => {
  const m = new Set((v.interets || []).map((i) => i.code));
  let n = 0; for (const x of c.interets || []) if (m.has(x.code)) n += 1;
  return n * 3;
};

function deps(over = {}) {
  const ecrit = [];
  const dissoutes = [];
  const notified = [];
  let lastPass = null;
  const base = {
    loadConfig: async () => CFG,
    getLastPassAt: async () => lastPass,
    setLastPassAt: async (ts) => { lastPass = ts; },
    loadStaleProposed: async () => [],
    dissolvePairs: async (ps) => { dissoutes.push(...ps); },
    loadLockedPairs: async () => [],
    loadVivier: async () => ({ profils: new Map(), eligibles: new Map() }),
    // Le vrai writePairs renvoie les paires RÉELLEMENT créées (celles non refusées
    // par le trigger) — l'orchestrateur s'en sert pour notifier et compter.
    writePairs: async (ps) => { ecrit.push(...ps); return ps; },
    notifyProposed: async (uid) => { notified.push(uid); },
    scoreOf: scoreTest,
    desirabiliteOf: () => 0.5,
    logger: { info() {}, warn() {} },
    _lu: () => ({ ecrit, dissoutes, notified, lastPass }),
  };
  return { ...base, ...over };
}

// Deux profils compatibles + éligibilité réciproque.
function viviersDeux() {
  const p = (id) => ({ id, interets: [{ code: 'x' }], langues: [] });
  return {
    profils: new Map([['a', p('a')], ['b', p('b')]]),
    eligibles: new Map([['a', ['b']], ['b', ['a']]]),
  };
}

test('hors de la fenêtre, la passe ne fait RIEN', async () => {
  const d = deps({ loadVivier: async () => viviersDeux() });
  const r = await runMysteryPass(d, H(10)); // 10h UTC, tirage à 21h
  assert.equal(r.skipped, 'hors-fenetre');
  assert.equal(d._lu().ecrit.length, 0);
});

test('dans la fenêtre, une paire évidente est écrite', async () => {
  const d = deps({ loadVivier: async () => viviersDeux() });
  const r = await runMysteryPass(d, H(21));
  assert.equal(r.paires, 1);
  assert.deepEqual(d._lu().ecrit[0].slice().sort(), ['a', 'b']);
});

test('la passe ne repasse pas avant pass_minutes (throttle)', async () => {
  let last = H(21);
  const d = deps({
    loadVivier: async () => viviersDeux(),
    getLastPassAt: async () => last,
    setLastPassAt: async (t) => { last = t; },
  });
  const r = await runMysteryPass(d, H(21) + 5 * 60000); // +5 min
  assert.equal(r.skipped, 'trop-tot');
  assert.equal(d._lu().ecrit.length, 0);
});

test('la passe repasse après pass_minutes', async () => {
  const d = deps({
    loadVivier: async () => viviersDeux(),
    getLastPassAt: async () => H(21),
  });
  const r = await runMysteryPass(d, H(21) + 11 * 60000); // +11 min
  assert.equal(r.paires, 1);
});

test('les propositions périmées sont DISSOUTES (auto-réparation)', async () => {
  const d = deps({
    loadVivier: async () => ({ profils: new Map(), eligibles: new Map() }),
    loadStaleProposed: async () => [['x', 'y']],
  });
  const r = await runMysteryPass(d, H(21));
  assert.deepEqual(d._lu().dissoutes, [['x', 'y']]);
  assert.equal(r.dissoutes, 1);
});

test('une aventure VERROUILLÉE n’est jamais réécrite', async () => {
  // a+b jouent déjà (active). c+d libres et compatibles.
  const p = (id) => ({ id, interets: [{ code: 'x' }] });
  const d = deps({
    loadLockedPairs: async () => [['a', 'b']],
    loadVivier: async () => ({
      profils: new Map(['a', 'b', 'c', 'd'].map((id) => [id, p(id)])),
      eligibles: new Map([
        ['a', ['b', 'c', 'd']], ['b', ['a', 'c', 'd']],
        ['c', ['a', 'b', 'd']], ['d', ['a', 'b', 'c']],
      ]),
    }),
  });
  const r = await runMysteryPass(d, H(21));
  // On écrit c+d, jamais a+b (déjà en base, verrouillée).
  const ecrit = d._lu().ecrit.map((x) => x.slice().sort());
  assert.deepEqual(ecrit, [['c', 'd']]);
  assert.equal(r.paires, 1);
});

test('forcer (test) ignore la fenêtre, mais JAMAIS le plancher', async () => {
  // `force` = pour tester à la demande hors des heures. On ignore la fenêtre et
  // le throttle, mais le plancher HORS fenêtre (50) s'applique quand même à
  // H(10) → 50 > 3 → aucune paire. On n'abaisse jamais le plancher pour « voir
  // quelque chose ».
  const d = deps({ loadVivier: async () => viviersDeux() });
  const r = await runMysteryPass(d, H(10), { force: true });
  assert.equal(r.forced, true);
  assert.equal(r.paires, 0);
});

test('forcer DANS la fenêtre écrit bien la paire (throttle ignoré)', async () => {
  const d = deps({
    loadVivier: async () => viviersDeux(),
    getLastPassAt: async () => H(21), // vient de passer → normalement throttlé
  });
  const r = await runMysteryPass(d, H(21) + 60000, { force: true });
  assert.equal(r.paires, 1);
});

test('rien à apparier → aucune écriture, mais la passe est enregistrée', async () => {
  const d = deps({ loadVivier: async () => ({ profils: new Map(), eligibles: new Map() }) });
  const r = await runMysteryPass(d, H(21));
  assert.equal(r.paires, 0);
  assert.equal(d._lu().ecrit.length, 0);
  assert.equal(d._lu().lastPass, H(21)); // la passe a bien tourné
});

test('une paire créée → « un mystère t\'attend » aux DEUX membres', async () => {
  const d = deps({ loadVivier: async () => viviersDeux() });
  await runMysteryPass(d, H(21));
  assert.deepEqual(d._lu().notified.slice().sort(), ['a', 'b']);
});

test('on ne notifie QUE les paires réellement créées (writePairs filtre les refus)', async () => {
  // Simule un trigger « un seul mystère actif » qui refuse la paire : writePairs
  // ne renvoie rien → personne n'est notifié (pas de faux « un mystère t'attend »).
  const d = deps({
    loadVivier: async () => viviersDeux(),
    writePairs: async () => [],
  });
  const r = await runMysteryPass(d, H(21));
  assert.equal(r.paires, 0);
  assert.equal(d._lu().notified.length, 0);
});

test('aucune notif pour une aventure verrouillée (rien de nouveau créé)', async () => {
  const d = deps({
    loadLockedPairs: async () => [['a', 'b']],
    loadVivier: async () => viviersDeux(), // a,b déjà verrouillés → rien de neuf
  });
  await runMysteryPass(d, H(21));
  assert.equal(d._lu().notified.length, 0);
});
