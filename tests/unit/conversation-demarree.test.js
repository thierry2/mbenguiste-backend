'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// « LA CONVERSATION A COMMENCÉ » — la règle qui consomme une révélation.
//
// Après une victoire au Mystère, la carte du visage dévoilé reste dans l'onglet
// tant que la conversation n'a pas VRAIMENT démarré : « aux premiers messages
// ENTRE LES DEUX ». Un message parti sans réponse ne consomme rien — si j'écris
// et qu'on ne me répond jamais, il ne s'est rien passé.
//
// Cette règle existait déjà côté client (`estConsommee`) mais ses deux drapeaux
// n'étaient JAMAIS remplis par de vraies données : chaque téléphone décidait
// dans son coin, à partir d'un tap local. D'où le bug du 21/07 — le mystère
// disparu sur un téléphone, toujours affiché sur l'autre. La vérité doit venir
// du SERVEUR, la seule chose que les deux téléphones ont en commun.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { conversationDemarree } = require('../../src/domain/conversation');

const MOI = 'u-moi';
const AUTRE = 'u-autre';

describe('il faut les DEUX', () => {
  test('les deux ont écrit → la conversation a commencé', () => {
    assert.equal(conversationDemarree([MOI, AUTRE], MOI), true);
  });

  test('ordre indifférent (c’est un fait, pas une chronologie)', () => {
    assert.equal(conversationDemarree([AUTRE, MOI, AUTRE, MOI], MOI), true);
  });

  test('moi seul, même dix fois → rien n’a commencé', () => {
    assert.equal(conversationDemarree([MOI, MOI, MOI], MOI), false);
  });

  test('l’autre seul → rien non plus (on ne m’a pas encore lu)', () => {
    assert.equal(conversationDemarree([AUTRE, AUTRE], MOI), false);
  });

  test('aucun message → non', () => {
    assert.equal(conversationDemarree([], MOI), false);
  });
});

describe('les deux téléphones doivent tomber d’accord', () => {
  test('même verdict vu de l’un et de l’autre — c’est tout l’intérêt', () => {
    const expediteurs = [MOI, AUTRE];
    assert.equal(
      conversationDemarree(expediteurs, MOI),
      conversationDemarree(expediteurs, AUTRE),
    );
  });
});

describe('entrées douteuses : on ne dit jamais oui par accident', () => {
  test('liste absente → non', () => {
    assert.equal(conversationDemarree(null, MOI), false);
    assert.equal(conversationDemarree(undefined, MOI), false);
  });

  test('sans mon id → non (on ne devine pas qui je suis)', () => {
    assert.equal(conversationDemarree([MOI, AUTRE], null), false);
  });

  test('les valeurs vides ne comptent pas comme un interlocuteur', () => {
    assert.equal(conversationDemarree([MOI, null, undefined, ''], MOI), false);
  });
});
