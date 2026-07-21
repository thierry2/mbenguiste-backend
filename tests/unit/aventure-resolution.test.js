'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION D'AVENTURE — SERVEUR AUTORITAIRE (décision 20/07).
//
// C'est le serveur qui tranche l'issue d'une étape à partir des DEUX réponses —
// jamais chaque client (sinon deux téléphones se contredisent). DÉTERMINISTE :
// pas de hasard, la politique « échec forcé à la dernière épreuve, Joker qui
// révèle » remplace la proba. Ces tests figent chaque cas.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  resoudreEtape, estEpreuveFinale, trouveEpreuveFinale, comboKey, survitAccord, doitInjecterIntime,
} = require('../../src/domain/aventure');
const { GROTTE } = require('../../src/domain/aventureGraphe');

const N = (id) => GROTTE.nodes[id];
const ctx = (over = {}) => ({ jokerUsed: false, toursDesaccord: 0, ...over });

test('comboKey : AA / BB / AB', () => {
  assert.equal(comboKey(0, 0), 'AA');
  assert.equal(comboKey(1, 1), 'BB');
  assert.equal(comboKey(0, 1), 'AB');
  assert.equal(comboKey(1, 0), 'AB');
});

test('estEpreuveFinale : n7 mène à la révélation, pas les autres', () => {
  assert.equal(estEpreuveFinale(GROTTE, 'n7'), true);
  for (const id of ['n1', 'n2', 'n3', 'n5', 'n6']) assert.equal(estEpreuveFinale(GROTTE, id), false);
  assert.equal(estEpreuveFinale(GROTTE, 'n4'), false);   // intime
  assert.equal(estEpreuveFinale(GROTTE, 'n4b'), false);  // consentement
});

test('trouveEpreuveFinale : c’est n7 (là où le Joker renvoie)', () => {
  assert.equal(trouveEpreuveFinale(GROTTE), 'n7');
  assert.equal(trouveEpreuveFinale({ nodes: {} }), null);
  assert.equal(trouveEpreuveFinale(null), null);
});

// ── Épreuves ─────────────────────────────────────────────────────────────────

test('ACCORD sur une épreuve normale → survie, on avance', () => {
  const r = resoudreEtape(GROTTE, N('n2'), { a: 0, b: 0 }, ctx());
  assert.equal(r.issue, 'survie');
  assert.equal(r.next, 'n3');
  assert.equal(r.reveal, 'ville');       // l'indice se gagne
});

test('AA et BB donnent EXACTEMENT la même issue (l’option ne change rien)', () => {
  const aa = resoudreEtape(GROTTE, N('n2'), { a: 0, b: 0 }, ctx());
  const bb = resoudreEtape(GROTTE, N('n2'), { a: 1, b: 1 }, ctx());
  assert.deepEqual(aa, bb);
});

test('la DERNIÈRE épreuve ÉCHOUE sans Joker (il ne manque que le visage)', () => {
  const r = resoudreEtape(GROTTE, N('n7'), { a: 0, b: 0 }, ctx({ jokerUsed: false }));
  assert.equal(r.issue, 'mort');
  assert.equal(r.next, 'fin_mort');
  assert.equal(r.reveal, undefined);     // jamais d'indice sur une mort
});

test('la DERNIÈRE épreuve RÉUSSIT avec le Joker → révélation', () => {
  const r = resoudreEtape(GROTTE, N('n7'), { a: 0, b: 0 }, ctx({ jokerUsed: true }));
  assert.equal(r.issue, 'survie');
  assert.equal(r.next, 'fin_plage');
});

test('toutes les épreuves AVANT la finale réussissent, Joker ou non', () => {
  for (const id of ['n1', 'n2', 'n3', 'n5', 'n6']) {
    assert.equal(resoudreEtape(GROTTE, N(id), { a: 0, b: 0 }, ctx()).issue, 'survie');
  }
});

test('DÉSACCORD → on rejoue (boucle), on ne quitte pas le nœud', () => {
  const r = resoudreEtape(GROTTE, N('n2'), { a: 0, b: 1 }, ctx({ toursDesaccord: 0 }));
  assert.equal(r.issue, 'boucle');
  assert.equal(r.next, null);
  assert.equal(r.tour, 1);
});

test('DÉSACCORD au plafond de tours → mort', () => {
  const r = resoudreEtape(GROTTE, N('n2'), { a: 0, b: 1 }, ctx({ toursDesaccord: 5 }));
  assert.equal(r.issue, 'mort');
  assert.equal(r.next, 'fin_desaccord');
});

// ── Consentement ─────────────────────────────────────────────────────────────

test('CONSENTEMENT : les deux « on continue » → on continue', () => {
  const r = resoudreEtape(GROTTE, N('n4b'), { a: 0, b: 0 }, ctx());
  assert.equal(r.next, 'n5');
  assert.equal(r.issue, 'survie');
});

test('CONSENTEMENT : un seul « on s’arrête » → sortie propre', () => {
  for (const rep of [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 1 }]) {
    const r = resoudreEtape(GROTTE, N('n4b'), rep, ctx());
    assert.equal(r.next, 'fin_separes');
  }
});

// ── Intime ───────────────────────────────────────────────────────────────────

test('INTIME : suite générique (la suite ne dépend pas du message)', () => {
  const r = resoudreEtape(GROTTE, N('n4'), { a: null, b: null }, ctx());
  assert.equal(r.next, 'n4b');
  assert.equal(r.reveal, 'aveu');
});

// ── L'issue terminale ────────────────────────────────────────────────────────

test('un nœud suivant de type end porte l’issue de l’aventure', () => {
  // n7 sans Joker → fin_mort (echec) ; avec Joker → fin_plage (match).
  const perte = resoudreEtape(GROTTE, N('n7'), { a: 0, b: 0 }, ctx());
  assert.equal(GROTTE.nodes[perte.next].end, 'echec');
  const gagne = resoudreEtape(GROTTE, N('n7'), { a: 0, b: 0 }, ctx({ jokerUsed: true }));
  assert.equal(GROTTE.nodes[gagne.next].end, 'match');
});

// ── Déterminisme CONFIGURABLE PAR LE GRAPHE (21/07) ──────────────────────────
// « ça ne doit pas être fixé en dur dans le code » — le graphe pilote la proba
// de chaque épreuve ; le Joker garde le dernier mot sur la finale.
describe('survitAccord — le graphe pilote, jamais le code en dur', () => {
  const graphAvecFin = { nodes: {
    fin: { kind: 'end', end: 'match' },
    ep: { kind: 'epreuve', accord: { survie: { next: 'fin' } } }, // ep = finale (mène à match)
  } };

  test('proba explicite à 1 → survit toujours, même sur la finale sans Joker', () => {
    const node = { kind: 'epreuve', accord: { proba: 1, survie: { next: 'fin' } } };
    assert.equal(survitAccord(node, graphAvecFin, { jokerUsed: false }), true);
  });

  test('proba explicite à 0 → meurt toujours, même hors finale', () => {
    const node = { kind: 'epreuve', accord: { proba: 0 } };
    assert.equal(survitAccord(node, { nodes: {} }, {}), false);
  });

  test('sans proba (graphe legacy) : tout survit, SAUF la finale sans Joker', () => {
    assert.equal(survitAccord(graphAvecFin.nodes.ep, graphAvecFin, { jokerUsed: false }), false);
    assert.equal(survitAccord({ kind: 'epreuve', accord: {} }, { nodes: {} }, {}), true);
  });

  test('le Joker garantit la finale, QUEL QUE SOIT le proba du graphe — mais pas une épreuve qui n’y mène pas', () => {
    const graph = { nodes: {
      match: { kind: 'end', end: 'match' },
      echec: { kind: 'end', end: 'echec' },
      finale: { kind: 'epreuve', accord: { proba: 0, survie: { next: 'match' } } },
      autre: { kind: 'epreuve', accord: { proba: 0, survie: { next: 'echec' } } }, // ne mène pas à match : PAS la finale
    } };
    assert.equal(survitAccord(graph.nodes.finale, graph, { jokerUsed: true }), true);   // Joker force la finale
    assert.equal(survitAccord(graph.nodes.autre, graph, { jokerUsed: true }), false);   // pas concernée, proba=0 tient
  });

  test('rng injectable : le tirage par défaut est déterministe (0)', () => {
    const node = { kind: 'epreuve', accord: { proba: 0.5 } };
    assert.equal(survitAccord(node, { nodes: {} }, {}), true); // 0 < 0.5
    assert.equal(survitAccord(node, { nodes: {} }, { rng: () => 1 }), false); // 1 < 0.5 faux
  });
});

test('resoudreEtape respecte le proba du graphe (pas seulement le code en dur)', () => {
  const graph = { nodes: {
    fin_mort: { kind: 'end', end: 'echec' },
    n: { kind: 'epreuve', accord: { proba: 0, survie: { next: 'x' }, mort: { next: 'fin_mort' } } },
  } };
  // AA/accord, mais proba=0 dans le graphe → meurt, alors que ce n'est pas la finale.
  const r = resoudreEtape(graph, graph.nodes.n, { a: 0, b: 0 }, ctx());
  assert.equal(r.issue, 'mort');
  assert.equal(r.next, 'fin_mort');
});

describe('doitInjecterIntime — casser la boucle plutôt que la répéter (miroir front)', () => {
  test('1er désaccord : pas encore de négociation', () => { assert.equal(doitInjecterIntime(1, 6), false); });
  test('2e désaccord : négociation', () => { assert.equal(doitInjecterIntime(2, 6), true); });
  test('3e : non, 4e : oui (une fois sur deux)', () => {
    assert.equal(doitInjecterIntime(3, 6), false);
    assert.equal(doitInjecterIntime(4, 6), true);
  });
  test('au plafond, plus de négociation (la mort suit)', () => { assert.equal(doitInjecterIntime(6, 6), false); });
  test('seuls les tours pairs avant le plafond déclenchent', () => {
    const n = [1, 2, 3, 4, 5, 6].filter((t) => doitInjecterIntime(t, 6));
    assert.deepEqual(n, [2, 4]);
  });
});
