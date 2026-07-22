'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SERVICE D'AVENTURE — orchestration SERVEUR AUTORITAIRE (I/O injecté).
//
// Une réponse arrive → on l'enregistre. Tant que l'autre n'a pas répondu, on
// ATTEND (rien ne bouge). Quand les DEUX ont répondu, le serveur résout et fait
// avancer la session — c'est ce que les deux clients verront via Realtime.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
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

// ── NŒUD TERMINAL : une fin ne prend AUCUNE réponse ──────────────────────────
// Bug trouvé le 22/07 (sonde diag-aventure) : un client resté bloqué croit être
// sur la finale alors que le serveur est déjà sur `fin_mort` (échec). Le serveur
// enregistrait la réponse sous SON nœud courant — un nœud `end` — puis tentait
// de le « résoudre », ce qui n'a aucun sens et figeait tout. Une fin est
// terminale : elle ne s'enregistre pas et ne se résout pas.
test('réponse sur un nœud de FIN → refusée, RIEN enregistré, RIEN résolu', async () => {
  const d = deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'fin_mort',
      jokerUsed: false, toursDesaccord: 0, outcome: 'echec',
    }),
  });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.error, 'terminal');
  assert.equal(d._journal().answers.length, 0, 'aucune réponse enregistrée sur une fin');
  assert.equal(d._journal().avance.length, 0, 'aucune résolution sur une fin');
});

test('réponse sur un nœud INCONNU du graphe → refusée, rien enregistré', async () => {
  const d = deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'nexiste-pas',
      jokerUsed: false, toursDesaccord: 0, outcome: null,
    }),
  });
  const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
  assert.equal(r.error, 'terminal');
  assert.equal(d._journal().answers.length, 0);
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

// ── CERVEAU UNIQUE (034) : la session PORTE `negocier`/`clip_a_jouer`/
// `last_issue` — plus aucun client ne les recalcule sur son PROPRE compteur.
describe('la session écrite porte tout ce que l’écran doit rendre — les DEUX clients LISENT', () => {
  test('accord → last_issue + clip de conséquence (s’il existe) écrits, negocier=false', async () => {
    const d = deps(); // n2, accord (0,0) → survie vers n3
    await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    const patch = d._journal().avance[0];
    assert.equal(patch.lastIssue, 'survie');
    assert.equal(patch.negocier, false);
  });

  test('désaccord AU 2e TOUR → negocier=true, écrit dans la session (pas recalculé client)', async () => {
    const d = deps({ answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }) });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0, });
    // tour=1 (1er désaccord) : pas encore de négociation.
    assert.equal(r.negocier, false);
    assert.equal(d._journal().avance[0].negocier, false);
    assert.equal(d._journal().avance[0].lastIssue, 'boucle');
  });

  test('désaccord répété (tour pair) → negocier=true, IDENTIQUE pour les deux joueurs', async () => {
    // session déjà à 1 tour de désaccord → celui-ci porte le compteur à 2 (pair → négociation).
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'grotte-ci', currentNode: 'n2',
        jokerUsed: false, toursDesaccord: 1, outcome: null,
      }),
      answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }),
    });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.negocier, true);
    assert.equal(d._journal().avance[0].negocier, true);
    assert.equal(d._journal().avance[0].toursDesaccord, 2);
  });

  test('clip de conséquence : réponse renvoie le MÊME clip que celui écrit en session', async () => {
    const d = deps(); // n2 → n3, accord.survie.clip du graphe grotte-ci (si défini)
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.clipAJouer, d._journal().avance[0].clipAJouer);
  });
});

// ── LE CLIP QUI PRÉCÈDE LA NÉGOCIATION ───────────────────────────────────────
// Constaté sur device le 22/07 : au 1er désaccord le clip de reprise jouait
// bien, mais au 2e (celui qui ouvre la négociation) le formulaire de message
// tombait SEC. Or c'est justement au moment de demander aux deux de s'expliquer
// qu'il faut le leur dire dans le récit — et ce n'est pas la même vidéo que la
// simple reprise (« remettez-vous d'accord » ≠ « expliquez-vous »).
describe('désaccord : le clip servi dépend de ce qui suit', () => {
  // Graphe explicite : on ne dépend pas du contenu du graphe en dur.
  const g = {
    id: 'g', start: 'x', clips: {},
    nodes: {
      x: {
        kind: 'epreuve', options: ['A', 'B'],
        accord: { proba: 1, survie: { next: 'fin' }, mort: { next: 'fin' } },
        desaccord: { clip: 'x_reprise', clipNegociation: 'x_negoc', maxTours: 6, mort: 'fin' },
      },
      fin: { kind: 'end', end: 'echec' },
    },
  };
  const dd = (toursDesaccord) => deps({
    getSession: async () => ({
      id: 'S', pairId: 'P', graphId: 'g', currentNode: 'x',
      jokerUsed: false, toursDesaccord, outcome: null,
    }),
    answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }),
    graphe: () => g,
  });

  test('désaccord SIMPLE (tour impair) → clip de reprise', async () => {
    const d = dd(0);
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.negocier, false);
    assert.equal(r.clipAJouer, 'x_reprise');
    assert.equal(d._journal().avance[0].clipAJouer, 'x_reprise');
  });

  test('désaccord qui OUVRE LA NÉGOCIATION → clip de négociation, pas la reprise', async () => {
    const d = dd(1); // ce tour porte le compteur à 2 → négociation
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.negocier, true);
    assert.equal(r.clipAJouer, 'x_negoc');
    assert.equal(d._journal().avance[0].clipAJouer, 'x_negoc');
  });

  test('sans clip de négociation déclaré → REPLI sur la reprise (jamais rien)', async () => {
    // Un graphe qui n'a pas tourné la vidéo d'explication ne doit pas perdre la
    // vidéo qu'il a : mieux vaut la reprise que le formulaire sec.
    const sansNegoc = JSON.parse(JSON.stringify(g));
    delete sansNegoc.nodes.x.desaccord.clipNegociation;
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'g', currentNode: 'x',
        jokerUsed: false, toursDesaccord: 1, outcome: null,
      }),
      answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }),
      graphe: () => sansNegoc,
    });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.negocier, true);
    assert.equal(r.clipAJouer, 'x_reprise');
  });

  test('aucun clip du tout → null, jamais une clé inventée', async () => {
    const nu = JSON.parse(JSON.stringify(g));
    nu.nodes.x.desaccord = { maxTours: 6, mort: 'fin' };
    const d = deps({
      getSession: async () => ({
        id: 'S', pairId: 'P', graphId: 'g', currentNode: 'x',
        jokerUsed: false, toursDesaccord: 1, outcome: null,
      }),
      answersForNode: async () => ({ aRepondu: true, bRepondu: true, a: 0, b: 1 }),
      graphe: () => nu,
    });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.clipAJouer, null);
  });
});

// ── « ON T'ATTEND » — le trou central des notifications (audit 22/07) ────────
// Les push ne partaient QU'À la résolution, sur l'idée que « l'autre a déjà été
// prévenu à l'étape précédente ». Faux dans trois cas : la PREMIÈRE étape (aucune
// résolution ne la précède), une notification balayée, et l'après-Joker. Résultat
// vécu : quelqu'un attend pendant des heures un partenaire qui ne sait pas qu'on
// l'attend. Le message doit partir AU MOMENT où il devient vrai.
describe('quand j’ai répondu et que j’attends, le binôme est PRÉVENU', () => {
  const enAttente = (over = {}) => deps({
    answersForNode: async () => ({ aRepondu: true, bRepondu: false, a: 0, b: null }),
    ...over,
  });

  test('ma réponse laisse le binôme à jouer → push « on t’attend »', async () => {
    const envoyes = [];
    const d = enAttente({
      membresDePaire: async () => ['U', 'PARTENAIRE'],
      notifier: async (uid, type) => { envoyes.push({ uid, type }); },
    });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.waiting, true);
    assert.deepEqual(envoyes, [{ uid: 'PARTENAIRE', type: 'mystere_waiting' }]);
  });

  test('jamais à MOI — je viens de jouer, je suis devant l’écran', async () => {
    const envoyes = [];
    const d = enAttente({
      membresDePaire: async () => ['U', 'PARTENAIRE'],
      notifier: async (uid, type) => { envoyes.push({ uid, type }); },
    });
    await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(envoyes.every((e) => e.uid !== 'U'), true);
  });

  test('RENVOI de ma propre réponse → aucun push de plus (pas de harcèlement)', async () => {
    // J'avais déjà répondu sur ce nœud (reconnexion, double-tap, renvoi après
    // erreur réseau) : le binôme a déjà été prévenu, le re-sonner serait du bruit.
    const envoyes = [];
    const d = deps({
      answersForNode: async () => ({ aRepondu: true, bRepondu: false, a: 0, b: null }),
      membresDePaire: async () => ['U', 'PARTENAIRE'],
      notifier: async (uid, type) => { envoyes.push({ uid, type }); },
    });
    await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 1 });
    assert.equal(envoyes.length, 1, 'un seul « on t’attend » par nœud et par personne');
  });

  test('un push qui échoue ne casse PAS la soumission', async () => {
    const d = enAttente({
      membresDePaire: async () => ['U', 'PARTENAIRE'],
      notifier: async () => { throw new Error('service de push mort'); },
    });
    const r = await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(r.waiting, true);
  });

  test('quand les DEUX ont répondu, c’est la résolution qui notifie — pas « on t’attend »', async () => {
    const envoyes = [];
    const d = deps({
      membresDePaire: async () => ['U', 'PARTENAIRE'],
      notifier: async (uid, type) => { envoyes.push({ uid, type }); },
    });
    await soumettreReponse(d, { sessionId: 'S', userId: 'U', answerIndex: 0 });
    assert.equal(envoyes.some((e) => e.type === 'mystere_waiting'), false);
  });
});
