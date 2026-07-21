'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE CHOIX DU SCÉNARIO — déterministe, dérivé de la PAIRE.
//
// POURQUOI PAS UN TIRAGE AU HASARD. Le graphe était tiré par `Math.random()` à
// la création de la session. Ça marche… tant qu'il n'y a qu'un scénario. Dès le
// deuxième, l'onglet Mystère — qui précharge les clips AVANT que la session
// existe — n'a aucun moyen de savoir lequel sera tiré. Il préchargeait donc
// `grotte-ci` en dur, et se serait trompé une fois sur deux : buffering au
// démarrage, exactement ce que le préchargement existe pour éviter.
//
// En dérivant le choix de l'ID DE LA PAIRE, l'onglet et la création de session
// calculent le MÊME résultat sans rien se dire, et sans rien stocker de plus.
// Le hasard reste réel entre paires ; il devient juste reproductible pour une
// paire donnée — ce qui est aussi ce qu'on veut d'un scénario : il ne doit pas
// changer entre deux appels.
//
// (Serveur-autoritaire dans tous les cas : le client ne choisit jamais.)
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { choisirGraphe } = require('../../src/domain/grapheChoix');

const IDS = ['grotte-ci', 'marche-nuit', 'plage-aube'];

describe('même paire → toujours le même scénario', () => {
  test('deux appels donnent le même résultat', () => {
    assert.equal(choisirGraphe(IDS, 'paire-42'), choisirGraphe(IDS, 'paire-42'));
  });

  test('l’ordre de la liste ne change RIEN (la BD ne garantit aucun ordre)', () => {
    const desordre = ['plage-aube', 'grotte-ci', 'marche-nuit'];
    assert.equal(choisirGraphe(IDS, 'paire-42'), choisirGraphe(desordre, 'paire-42'));
  });

  test('le choix tombe toujours DANS la liste', () => {
    for (let i = 0; i < 50; i++) {
      assert.ok(IDS.includes(choisirGraphe(IDS, `paire-${i}`)));
    }
  });
});

describe('des paires différentes se répartissent', () => {
  test('50 paires ne tombent pas toutes sur le même scénario', () => {
    const vus = new Set();
    for (let i = 0; i < 50; i++) vus.add(choisirGraphe(IDS, `paire-${i}`));
    assert.equal(vus.size, IDS.length, 'les 3 scénarios doivent sortir');
  });

  test('la répartition n’est pas grossièrement biaisée', () => {
    const compte = new Map(IDS.map((id) => [id, 0]));
    const N = 600;
    for (let i = 0; i < N; i++) {
      const id = choisirGraphe(IDS, `paire-${i}-xyz`);
      compte.set(id, compte.get(id) + 1);
    }
    // Attendu ~200 chacun. On accepte large (100–300) : on vérifie l'absence de
    // biais grossier, pas la qualité cryptographique d'un générateur.
    for (const [id, n] of compte) {
      assert.ok(n > 100 && n < 300, `${id} sort ${n} fois sur ${N} — réparti trop inégalement`);
    }
  });
});

describe('on ne sert jamais un scénario qui n’existe pas', () => {
  test('liste vide → null', () => {
    assert.equal(choisirGraphe([], 'paire-1'), null);
    assert.equal(choisirGraphe(null, 'paire-1'), null);
  });

  test('un seul scénario → c’est celui-là, toujours', () => {
    assert.equal(choisirGraphe(['grotte-ci'], 'nimporte'), 'grotte-ci');
  });

  test('sans clé de paire → on rend quand même un scénario valide (jamais null)', () => {
    // Un appel sans paire (diagnostic, admin) ne doit pas casser : on retombe
    // sur le premier scénario par ordre stable, pas sur une erreur.
    assert.ok(IDS.includes(choisirGraphe(IDS, null)));
  });
});
