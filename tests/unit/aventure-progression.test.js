'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// OÙ EN EST CETTE AVENTURE ? — l'étape franchie, calculée depuis le GRAPHE.
//
// L'onglet Mystère affichait `etape: 0` EN DUR : même à quatre épreuves du but,
// il montrait le flou maximal, « Quelqu'un t'attend » et « Vivre l'Aventure »
// au lieu de « Reprendre ». Le flou est pourtant censé ÊTRE la jauge de
// progression — l'aiguille était collée à zéro.
//
// Le client ne peut pas le calculer : il ne connaît ni la session ni le nœud
// courant tant qu'il n'est pas DANS le lecteur. C'est donc au serveur de le
// dire, et à partir de la seule source de vérité : `current_node` + le graphe.
//
// Règle de comptage, miroir exact du lecteur (`totalSteps` dans [id].tsx) :
// comptent les épreuves et les intimes ; ne comptent NI les consentements
// (ce sont des portes, pas des étapes) NI les fins.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { progressionAventure } = require('../../src/domain/aventureProgression');

// Graphe de forme réaliste : 3 épreuves, 1 intime, 1 consentement, 3 fins.
const G = {
  start: 'n1',
  nodes: {
    n1:  { kind: 'epreuve', accord: { survie: { next: 'n2' }, mort: { next: 'fin_mort' } } },
    n2:  { kind: 'epreuve', accord: { survie: { next: 'n3' }, mort: { next: 'fin_mort' } } },
    n3:  { kind: 'intime', next: 'n3b' },
    n3b: { kind: 'consentement', oui: 'n4', non: 'fin_separes' },
    n4:  { kind: 'epreuve', accord: { survie: { next: 'fin_match' }, mort: { next: 'fin_mort' } } },
    fin_match:   { kind: 'end', end: 'match' },
    fin_mort:    { kind: 'end', end: 'echec' },
    fin_separes: { kind: 'end', end: 'left' },
  },
};

describe('le total ne compte que les vraies étapes', () => {
  test('épreuves + intimes ; ni consentement ni fin', () => {
    // n1, n2, n3, n4 → 4. (n3b est une porte, les 3 fins ne comptent pas.)
    assert.equal(progressionAventure(G, 'n1').total, 4);
  });
});

describe('l’étape franchie suit le chemin réel', () => {
  test('au départ, rien n’est franchi', () => {
    assert.equal(progressionAventure(G, 'n1').etape, 0);
  });

  test('à la 2e épreuve, une étape est derrière nous', () => {
    assert.equal(progressionAventure(G, 'n2').etape, 1);
  });

  test('à l’intime, deux étapes sont franchies', () => {
    assert.equal(progressionAventure(G, 'n3').etape, 2);
  });

  test('le consentement ne fait PAS avancer la jauge (c’est une porte)', () => {
    // Trois vraies étapes sont derrière (n1, n2, n3) — le consentement n'en est
    // pas une, il ne doit donc rien ajouter.
    assert.equal(progressionAventure(G, 'n3b').etape, 3);
  });

  test('à la finale, trois étapes sont derrière', () => {
    assert.equal(progressionAventure(G, 'n4').etape, 3);
  });
});

describe('les fins', () => {
  test('la victoire vaut le parcours entier', () => {
    const r = progressionAventure(G, 'fin_match');
    assert.equal(r.etape, r.total);
  });

  test('un échec ne remet pas la jauge à zéro — le chemin a bien été fait', () => {
    // On atteint fin_mort depuis n1 : une étape avait été franchie.
    assert.ok(progressionAventure(G, 'fin_mort').etape >= 1);
  });
});

describe('on n’invente jamais une progression', () => {
  test('nœud inconnu → 0 franchi (jamais un dévoilement par défaut)', () => {
    assert.equal(progressionAventure(G, 'nexiste-pas').etape, 0);
  });

  test('sans nœud courant → 0', () => {
    assert.equal(progressionAventure(G, null).etape, 0);
  });

  test('graphe absent ou vide → tout à zéro, aucune exception', () => {
    assert.deepEqual(progressionAventure(null, 'n1'), { etape: 0, total: 0 });
    assert.deepEqual(progressionAventure({}, 'n1'), { etape: 0, total: 0 });
  });

  test('un graphe qui BOUCLE ne fait pas tourner le calcul à l’infini', () => {
    const boucle = {
      start: 'a',
      nodes: {
        a: { kind: 'epreuve', accord: { survie: { next: 'b' }, mort: { next: 'a' } } },
        b: { kind: 'epreuve', accord: { survie: { next: 'a' }, mort: { next: 'b' } } },
      },
    };
    assert.equal(progressionAventure(boucle, 'b').etape, 1);
  });

  test('l’étape ne dépasse JAMAIS le total', () => {
    for (const id of Object.keys(G.nodes)) {
      const r = progressionAventure(G, id);
      assert.ok(r.etape <= r.total, `${id} : ${r.etape} > ${r.total}`);
    }
  });
});
