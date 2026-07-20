'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// L'APPARIEMENT DU MYSTÈRE — conception arrêtée le 18/07.
//
// Ce que ces tests FIGENT, parce que le cahier des charges l'a verrouillé :
//   · appariement MUTUEL (les deux se voient), algorithmique, SANS aucun like ;
//   · UN SEUL mystère par personne ;
//   · PLANCHER de compatibilité : en dessous, AUCUN mystère (jamais de tiède) ;
//   · la disponibilité DÉPARTAGE les ex æquo — jamais un filtre dur, jamais un
//     moyen de franchir le plancher ;
//   · tirage à un instant ABSOLU (minuit local fragmenterait le vivier) ;
//   · proposition SUBSTITUABLE tant que l'aventure n'a pas commencé, VERROUILLÉE
//     dès qu'elle commence ;
//   · deux planchers (pendant / hors fenêtre), réglables sans redéploiement.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  apparier, desirabiliteParDefaut, estDansLaFenetre, plancherApplicable, prochainTirage,
  CONFIG_DEFAUT,
} = require('../../src/domain/mystere');

// Profils minimaux : le domaine ne connaît que ce qui sert à SCORER.
const P = (id, over = {}) => ({
  id, interets: [], langues: [], bio: null, estVerifie: false, photos: [],
  enLigne: false, ...over,
});
const aff = (n) => ({ interets: Array.from({ length: n }, (_, i) => ({ code: `i${i}` })) });

/** Graphe d'éligibilité symétrique (les filtres durs vivent en SQL, pas ici). */
function tousEligibles(ids) {
  const m = new Map();
  for (const id of ids) m.set(id, ids.filter((x) => x !== id));
  return m;
}
const trie = (paire) => paire.slice().sort();

/**
 * Score de TEST, explicite et lisible. Le VRAI score unifié (goût appris,
 * désirabilité, réciprocité…) vit dans `ranking.js` et c'est le service qui
 * l'injecte : le domaine n'en héberge aucun, exprès.
 */
const scoreTest = (viewer, cand) => {
  const miens = new Set((viewer.interets || []).map((i) => i.code));
  let n = 0;
  for (const c of cand.interets || []) if (miens.has(c.code)) n += 1;
  return n * 3;
};
const app = (args) => apparier({ score: scoreTest, ...args });

// ── Mutualité et unicité ─────────────────────────────────────────────────────

test('sans personne, personne n’est apparié', async () => {
  const r = app({ profils: new Map(), eligibles: new Map(), plancher: 0 });
  assert.deepEqual(r.paires, []);
  assert.deepEqual(r.sansMystere, []);
});

test('une paire évidente est appariée, et elle est MUTUELLE', async () => {
  const profils = new Map([['a', P('a', aff(3))], ['b', P('b', aff(3))]]);
  const r = app({ profils, eligibles: tousEligibles(['a', 'b']), plancher: 1 });
  assert.equal(r.paires.length, 1);
  assert.deepEqual(trie(r.paires[0]), ['a', 'b']);
  assert.deepEqual(r.sansMystere, []);
});

test('PERSONNE n’apparaît dans deux paires — un seul mystère chacun', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const profils = new Map(ids.map((id) => [id, P(id, aff(3))]));
  const r = app({ profils, eligibles: tousEligibles(ids), plancher: 1 });
  const vus = r.paires.flat();
  assert.equal(new Set(vus).size, vus.length);
});

test('nombre IMPAIR : le dernier reste sans mystère, on ne l’invente pas', async () => {
  const ids = ['a', 'b', 'c'];
  const profils = new Map(ids.map((id) => [id, P(id, aff(3))]));
  const r = app({ profils, eligibles: tousEligibles(ids), plancher: 1 });
  assert.equal(r.paires.length, 1);
  assert.equal(r.sansMystere.length, 1);
});

test('on ne s’apparie jamais avec soi-même', async () => {
  const profils = new Map([['a', P('a', aff(3))]]);
  const r = app({ profils, eligibles: new Map([['a', ['a']]]), plancher: 0 });
  assert.deepEqual(r.paires, []);
  assert.deepEqual(r.sansMystere, ['a']);
});

test('l’éligibilité doit être RÉCIPROQUE : à sens unique, pas de paire', async () => {
  // Les filtres durs sont directionnels (mes préférences vs lui, et l'inverse).
  // Si je le vois mais qu'il ne me voit pas, il n'y a pas de mystère.
  const profils = new Map([['a', P('a', aff(3))], ['b', P('b', aff(3))]]);
  const eligibles = new Map([['a', ['b']], ['b', []]]);
  const r = app({ profils, eligibles, plancher: 1 });
  assert.deepEqual(r.paires, []);
  assert.deepEqual(r.sansMystere.slice().sort(), ['a', 'b']);
});

// ── Le plancher ──────────────────────────────────────────────────────────────

test('sous le plancher, AUCUN mystère (on ne sert jamais un médiocre)', async () => {
  const profils = new Map([['a', P('a')], ['b', P('b')]]); // score 0
  const r = app({ profils, eligibles: tousEligibles(['a', 'b']), plancher: 5 });
  assert.deepEqual(r.paires, []);
  assert.deepEqual(r.sansMystere.slice().sort(), ['a', 'b']);
});

test('le plancher vaut pour LES DEUX — le maillon faible décide', async () => {
  // `a` trouve `b` formidable, `b` ne trouve rien à `a`. Sans cette règle, on
  // imposerait à `b` un partenaire tiède parce que `a` est enthousiaste.
  const profils = new Map([['a', P('a')], ['b', P('b')]]);
  const asymetrique = (viewer) => (viewer.id === 'a' ? 10 : 0);
  const r = app({
    profils, eligibles: tousEligibles(['a', 'b']), plancher: 5, score: asymetrique,
  });
  assert.deepEqual(r.paires, []);
});

test('être EN LIGNE ne fait jamais franchir le plancher', async () => {
  const profils = new Map([
    ['a', P('a', { enLigne: true })], ['b', P('b', { enLigne: true })],
  ]);
  const r = app({ profils, eligibles: tousEligibles(['a', 'b']), plancher: 5 });
  assert.deepEqual(r.paires, []);
});

// ── Le classement ────────────────────────────────────────────────────────────

test('à compatibilité ÉGALE, celui qui est en ligne passe devant', async () => {
  const profils = new Map([
    ['a', P('a', { interets: [{ code: 'x' }] })],
    ['b', P('b', { interets: [{ code: 'x' }] })],
    ['c', P('c', { interets: [{ code: 'x' }], enLigne: true })],
  ]);
  const eligibles = new Map([['a', ['b', 'c']], ['b', ['a']], ['c', ['a']]]);
  const r = app({ profils, eligibles, plancher: 1 });
  assert.deepEqual(trie(r.paires[0]), ['a', 'c']);
});

test('une compatibilité SUPÉRIEURE bat la disponibilité', async () => {
  // Sinon « en ligne » deviendrait un filtre déguisé : le hors-ligne très
  // compatible doit gagner contre l'en-ligne tiède.
  const profils = new Map([
    ['a', P('a', { interets: [{ code: 'x' }, { code: 'y' }] })],
    ['b', P('b', { interets: [{ code: 'x' }, { code: 'y' }] })],
    ['c', P('c', { interets: [{ code: 'x' }], enLigne: true })],
  ]);
  const eligibles = new Map([['a', ['b', 'c']], ['b', ['a']], ['c', ['a']]]);
  const r = app({ profils, eligibles, plancher: 1 });
  assert.deepEqual(trie(r.paires[0]), ['a', 'b']);
});

test('la meilleure paire est servie EN PREMIER (glouton global)', async () => {
  const profils = new Map([
    ['a', P('a', aff(3))], ['b', P('b', aff(3))],
    ['c', P('c', { interets: [{ code: 'i0' }] })],
    ['d', P('d', { interets: [{ code: 'i0' }] })],
  ]);
  const r = app({ profils, eligibles: tousEligibles(['a', 'b', 'c', 'd']), plancher: 1 });
  assert.deepEqual(trie(r.paires[0]), ['a', 'b']);
  assert.deepEqual(trie(r.paires[1]), ['c', 'd']);
});

test('DÉTERMINISTE : même entrée, même sortie (rejouable, donc débogable)', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const profils = new Map(ids.map((id) => [
    id, P(id, { interets: [{ code: 'commun' }], langues: id < 'd' ? ['fr'] : [] }),
  ]));
  const args = { profils, eligibles: tousEligibles(ids), plancher: 0, seed: '2026-07-20' };
  assert.deepEqual(app(args), app(args));
});

// ── Proposition substituable ⇄ aventure verrouillée ──────────────────────────

test('une aventure commencée n’est jamais défaite ni resubstituée', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const profils = new Map(ids.map((id) => [id, P(id, { interets: [{ code: 'x' }] })]));
  const r = app({
    profils, eligibles: tousEligibles(ids), plancher: 1, verrouillees: [['a', 'b']],
  });
  assert.ok(r.paires.some((p) => p[0] === 'a' && p[1] === 'b'));
  const libres = r.paires.filter((p) => !(p[0] === 'a' && p[1] === 'b'));
  assert.deepEqual(libres.flat().sort(), ['c', 'd']);
});

test('une proposition NON commencée se refait librement à la passe suivante', async () => {
  // AUTO-RÉPARATION : rien n'est réservé, donc si l'un ne joue jamais, la paire
  // se défait toute seule au tour d'après. Aucune file d'attente nécessaire.
  const profils = new Map([
    ['a', P('a', { interets: [{ code: 'x' }] })],
    ['b', P('b', { interets: [{ code: 'x' }] })],
    ['c', P('c', { interets: [{ code: 'x' }] })],
  ]);
  const r = app({
    profils, eligibles: new Map([['a', ['c']], ['c', ['a']], ['b', []]]), plancher: 1,
  });
  assert.deepEqual(trie(r.paires[0]), ['a', 'c']);
  assert.deepEqual(r.sansMystere, ['b']);
});

// ── La fenêtre de tirage ─────────────────────────────────────────────────────

const cfg = { ...CONFIG_DEFAUT, heureTirageUtc: 21, fenetreMinutes: 120, pasMinutes: 10 };
const t = (iso) => new Date(iso).getTime();

test('à l’heure pile, on est dans la fenêtre', async () => {
  assert.equal(estDansLaFenetre(t('2026-07-20T21:00:00Z'), cfg), true);
});

test('la fenêtre DURE — elle n’est pas un instant (tolérance aux retards)', async () => {
  assert.equal(estDansLaFenetre(t('2026-07-20T22:30:00Z'), cfg), true);
  assert.equal(estDansLaFenetre(t('2026-07-20T23:01:00Z'), cfg), false);
});

test('hors fenêtre avant l’heure', async () => {
  assert.equal(estDansLaFenetre(t('2026-07-20T20:59:00Z'), cfg), false);
});

test('l’heure est ABSOLUE : minuit LOCAL fragmenterait le vivier par fuseau', async () => {
  // Paris et Dakar ne seraient jamais dans la même passe — l'exact contraire du
  // but, et ça casserait l'appariement transfrontalier qui est la signature.
  assert.equal(estDansLaFenetre(t('2026-07-20T21:30:00Z'), cfg), true);
});

test('le prochain tirage tombe à l’heure dite, le jour même ou le lendemain', async () => {
  assert.equal(
    new Date(prochainTirage(t('2026-07-20T10:00:00Z'), cfg)).toISOString(),
    '2026-07-20T21:00:00.000Z',
  );
  assert.equal(
    new Date(prochainTirage(t('2026-07-20T23:30:00Z'), cfg)).toISOString(),
    '2026-07-21T21:00:00.000Z',
  );
});

test('L’HEURE EST RÉGLABLE — jamais figée dans le code', async () => {
  const tot = { ...cfg, heureTirageUtc: 19 };
  assert.equal(estDansLaFenetre(t('2026-07-20T19:30:00Z'), tot), true);
  assert.equal(estDansLaFenetre(t('2026-07-20T21:30:00Z'), tot), false);
});

// ── Les deux planchers ───────────────────────────────────────────────────────

const cfgP = {
  ...CONFIG_DEFAUT,
  heureTirageUtc: 21, fenetreMinutes: 120,
  plancherFenetre: 10, plancherHorsFenetre: 20,
};

test('pendant la fenêtre, le vivier est maximal → plancher plus accessible', async () => {
  assert.equal(plancherApplicable(t('2026-07-20T21:30:00Z'), cfgP), 10);
});

test('hors fenêtre, le vivier est mince → plancher PLUS HAUT, pas plus bas', async () => {
  // Le piège serait de le baisser quand il y a peu de monde, pour « quand même »
  // servir un mystère. C'est exactement ce que le cahier interdit.
  assert.equal(plancherApplicable(t('2026-07-20T10:00:00Z'), cfgP), 20);
});

test('les deux planchers sont réglables sans toucher au code', async () => {
  const strict = { ...cfgP, plancherFenetre: 30, plancherHorsFenetre: 50 };
  assert.equal(plancherApplicable(t('2026-07-20T21:30:00Z'), strict), 30);
  assert.equal(plancherApplicable(t('2026-07-20T10:00:00Z'), strict), 50);
});

// ── L'APPARIEMENT ASSORTATIF ─────────────────────────────────────────────────
// « Les plus désirés ensemble, les moins désirés ensemble. » Dit sans détour :
// ce n'est pas un jugement, c'est la seule façon qu'un appariement IMPOSÉ 1:1
// soit vivable des deux côtés. Sans lui, on colle à quelqu'un un partenaire qui
// ne le regardera pas — et les deux perdent leur unique mystère du jour.

const D = (id, desirabilite, over = {}) => P(id, { desirabilite, ...over });

test('les plus désirés vont ensemble, les moins désirés aussi', async () => {
  // Compatibilité IDENTIQUE partout : seule la désirabilité peut décider.
  const ids = ['haut1', 'haut2', 'bas1', 'bas2'];
  const profils = new Map([
    ['haut1', D('haut1', 0.9, { interets: [{ code: 'x' }] })],
    ['haut2', D('haut2', 0.9, { interets: [{ code: 'x' }] })],
    ['bas1', D('bas1', 0.1, { interets: [{ code: 'x' }] })],
    ['bas2', D('bas2', 0.1, { interets: [{ code: 'x' }] })],
  ]);
  const r = app({ profils, eligibles: tousEligibles(ids), plancher: 1 });
  const paires = r.paires.map(trie).sort();
  assert.deepEqual(paires, [['bas1', 'bas2'], ['haut1', 'haut2']]);
});

test('une paire très déséquilibrée est évitée quand une alternative existe', async () => {
  const ids = ['star', 'moyen', 'discret'];
  const profils = new Map([
    ['star', D('star', 1, { interets: [{ code: 'x' }] })],
    ['moyen', D('moyen', 0.55, { interets: [{ code: 'x' }] })],
    ['discret', D('discret', 0.1, { interets: [{ code: 'x' }] })],
  ]);
  const r = app({ profils, eligibles: tousEligibles(ids), plancher: 1 });
  assert.deepEqual(trie(r.paires[0]), ['moyen', 'star']);
  assert.deepEqual(r.sansMystere, ['discret']);
});

test('le curseur assortatif est RÉGLABLE — à 0, l’écart cesse de compter', async () => {
  const ids = ['haut1', 'haut2', 'bas1', 'bas2'];
  const profils = new Map([
    ['haut1', D('haut1', 0.9, { interets: [{ code: 'x' }, { code: 'y' }] })],
    ['bas1', D('bas1', 0.1, { interets: [{ code: 'x' }, { code: 'y' }] })],
    ['haut2', D('haut2', 0.9, { interets: [{ code: 'x' }] })],
    ['bas2', D('bas2', 0.1, { interets: [{ code: 'x' }] })],
  ]);
  // Curseur à 0 : la compatibilité seule décide → la paire mixte très
  // compatible passe devant. C'est le comportement qu'on VEUT pouvoir régler.
  const sans = app({
    profils, eligibles: tousEligibles(ids), plancher: 1,
    config: { poidsEcartDesirabilite: 0 },
  });
  assert.deepEqual(trie(sans.paires[0]), ['bas1', 'haut1']);
});

test('la désirabilité ne contourne JAMAIS le plancher', async () => {
  // Deux profils très désirés mais sans aucune compatibilité : pas de mystère.
  // La beauté ne rachète pas l'incompatibilité.
  const profils = new Map([['a', D('a', 1)], ['b', D('b', 1)]]);
  const r = app({ profils, eligibles: tousEligibles(['a', 'b']), plancher: 5 });
  assert.deepEqual(r.paires, []);
});

test('COLD START : sans donnée, personne n’est décrété beau ni laid', async () => {
  // Invariant maison : agrégats vides → NEUTRE 0.5. Un profil neuf ne doit pas
  // être relégué faute de télémétrie.
  assert.equal(desirabiliteParDefaut({}), 0.5);
  assert.equal(desirabiliteParDefaut({ desirabilite: undefined }), 0.5);
  assert.equal(desirabiliteParDefaut({ desirabilite: 0.8 }), 0.8);
});

test('deux profils NEUFS s’apparient normalement entre eux', async () => {
  const profils = new Map([
    ['neuf1', P('neuf1', { interets: [{ code: 'x' }] })],  // pas de désirabilité
    ['neuf2', P('neuf2', { interets: [{ code: 'x' }] })],
  ]);
  const r = app({ profils, eligibles: tousEligibles(['neuf1', 'neuf2']), plancher: 1 });
  assert.equal(r.paires.length, 1);
});

// ── UN SEUL score dans tout le produit ───────────────────────────────────────

test('le score DOIT être injecté — aucun score maison ne peut repousser ici', async () => {
  // Le cahier de similarité §4 : « un seul calcul, réutilisé par deck / Mystère
  // / picks ». Une V1 de ce fichier recopiait la formule de picks.js — la
  // duplication exacte qui a déjà produit deux bugs. On la rend impossible.
  assert.throws(
    () => apparier({ profils: new Map(), eligibles: new Map() }),
    /score unifié/,
  );
});
