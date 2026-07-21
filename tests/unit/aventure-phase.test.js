'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Miroir SERVEUR de frontend/src/lib/__tests__/aventureMachine.test.ts — mêmes
// scénarios, pour garantir que les deux machines ne peuvent PAS diverger.
// C'est CETTE instance (serveur) qui tranche désormais ; le front ne fait que
// rendre la session qui en résulte.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PHASE_INITIALE, transition, peutRepondre, clipActif } = require('../../src/domain/aventurePhase');

const epreuve = (over = {}) => ({ kind: 'epreuve', aClip: true, aUnIndice: true, ...over });
const intime = (over = {}) => ({ kind: 'intime', aClip: true, aUnIndice: true, ...over });

describe('PHASE_INITIALE', () => {
  test('un nœud avec clip commence par sa scène', () => {
    assert.equal(PHASE_INITIALE(epreuve()), 'scene');
  });
  test('un nœud sans clip pose sa question tout de suite', () => {
    assert.equal(PHASE_INITIALE(epreuve({ aClip: false })), 'choix');
  });
  test('un nœud de fin va droit à la fin', () => {
    assert.equal(PHASE_INITIALE({ kind: 'end', aClip: false }), 'fin');
  });
});

describe('fil nominal', () => {
  test('la question n’arrive qu’à la fin du clip', () => {
    assert.equal(transition('scene', { type: 'clipFini' }, epreuve()), 'choix');
  });
  test('répondre met en attente', () => {
    assert.equal(transition('choix', { type: 'jeReponds' }, epreuve()), 'attente');
  });
  test('sa réponse arrivée, on résout', () => {
    assert.equal(transition('attente', { type: 'ilRepond' }, epreuve()), 'resolution');
  });
});

describe('aucune phase n’attend sans issue', () => {
  test('l’autre ne répond pas → « absent »', () => {
    assert.equal(transition('attente', { type: 'delaiEcoule' }, epreuve()), 'absent');
    assert.equal(transition('attente', { type: 'delaiEcoule' }, intime()), 'absent');
  });
  test('depuis absent, la relance remet en attente', () => {
    assert.equal(transition('absent', { type: 'relance' }, epreuve()), 'attente');
  });
  test('l’autre peut arriver en retard', () => {
    assert.equal(transition('absent', { type: 'ilRepond' }, epreuve()), 'resolution');
  });
  test('toute phase non terminale a au moins une sortie', () => {
    const phases = ['scene', 'choix', 'attente', 'absent', 'resolution', 'recompense', 'reprise', 'negociation'];
    const evs = ['clipFini', 'jeReponds', 'ilRepond', 'delaiEcoule', 'resolu', 'beatFini', 'repriseFinie', 'negociationFinie', 'relance'];
    for (const p of phases) {
      const sorties = evs.filter((t) => transition(p, { type: t }, epreuve({ issue: 'survie' })) !== p);
      assert.ok(sorties.length > 0, `phase ${p} sans sortie`);
    }
  });
});

describe('la résolution route selon l’issue', () => {
  test('survie + indice → récompense', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, epreuve({ issue: 'survie', aUnIndice: true })), 'recompense');
  });
  test('survie sans indice → on enchaîne', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, epreuve({ issue: 'survie', aUnIndice: false })), 'suivant');
  });
  test('mort → fin, même avec indice', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, epreuve({ issue: 'mort', aUnIndice: true })), 'fin');
  });
  test('désaccord → reprise', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, epreuve({ issue: 'boucle' })), 'reprise');
  });
  test('désaccord au bon tour → négociation', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, epreuve({ issue: 'boucle', doitNegocier: true })), 'negociation');
  });
  test('nœud intime livre son indice comme toute étape', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, intime()), 'recompense');
  });
  test('consentement accepté enchaîne, refusé va à la fin', () => {
    const consent = (issue) => ({ kind: 'consentement', aClip: true, aUnIndice: false, issue });
    assert.equal(transition('resolution', { type: 'resolu' }, consent('survie')), 'suivant');
    assert.equal(transition('resolution', { type: 'resolu' }, consent('mort')), 'fin');
  });
});

describe('les retours vers la question ne rejouent jamais la scène', () => {
  test('la reprise ramène à la question', () => {
    assert.equal(transition('reprise', { type: 'repriseFinie' }, epreuve()), 'choix');
  });
  test('la négociation ramène à la question', () => {
    assert.equal(transition('negociation', { type: 'negociationFinie' }, epreuve()), 'choix');
  });
  test('aucun chemin ne revient en scene après une réponse', () => {
    const apres = ['choix', 'attente', 'absent', 'resolution', 'recompense', 'reprise', 'negociation'];
    const evs = ['clipFini', 'jeReponds', 'ilRepond', 'delaiEcoule', 'beatFini', 'repriseFinie', 'negociationFinie', 'relance', 'resolu', 'continuer', 'terminer'];
    for (const p of apres) {
      for (const t of evs) {
        assert.notEqual(transition(p, { type: t }, epreuve({ issue: 'boucle' })), 'scene');
      }
    }
  });
});

describe('la récompense s’interpose', () => {
  test('le beat terminé, on passe au nœud suivant', () => {
    assert.equal(transition('recompense', { type: 'beatFini' }, epreuve()), 'suivant');
  });
  test('pendant la récompense, rien d’autre ne peut arriver', () => {
    for (const t of ['clipFini', 'jeReponds', 'ilRepond', 'delaiEcoule']) {
      assert.equal(transition('recompense', { type: t }, epreuve()), 'recompense');
    }
  });
});

describe('les phases terminales sont des culs-de-sac', () => {
  test('suivant et fin n’acceptent plus rien', () => {
    for (const t of ['clipFini', 'jeReponds', 'ilRepond', 'resolu', 'beatFini']) {
      assert.equal(transition('suivant', { type: t }, epreuve()), 'suivant');
      assert.equal(transition('fin', { type: t }, epreuve()), 'fin');
    }
  });
});

describe('robustesse aux événements hors contexte', () => {
  test('une fin de clip pendant l’attente est ignorée', () => {
    assert.equal(transition('attente', { type: 'clipFini' }, epreuve()), 'attente');
  });
  test('une réponse pendant la scène est ignorée', () => {
    assert.equal(transition('scene', { type: 'jeReponds' }, epreuve()), 'scene');
  });
  test('deux résolutions d’affilée ne doublent pas l’avance', () => {
    const p1 = transition('resolution', { type: 'resolu' }, epreuve({ issue: 'survie', aUnIndice: false }));
    assert.equal(p1, 'suivant');
    assert.equal(transition(p1, { type: 'resolu' }, epreuve({ issue: 'survie' })), 'suivant');
  });
});

describe('la conséquence est une vidéo, pas une notification', () => {
  const avecClip = (over = {}) => ({ kind: 'epreuve', aClip: true, aUnIndice: true, aUnClipConsequence: true, ...over });

  test('survie → clip de succès avant récompense', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, avecClip({ issue: 'survie' })), 'consequence');
  });
  test('mort → clip de mort avant l’échec', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, avecClip({ issue: 'mort' })), 'consequence');
  });
  test('clip fini, survie avec indice → récompense', () => {
    assert.equal(transition('consequence', { type: 'clipFini' }, avecClip({ issue: 'survie', aUnIndice: true })), 'recompense');
  });
  test('clip fini, survie sans indice → suivant', () => {
    assert.equal(transition('consequence', { type: 'clipFini' }, avecClip({ issue: 'survie', aUnIndice: false })), 'suivant');
  });
  test('clip fini, mort → fin', () => {
    assert.equal(transition('consequence', { type: 'clipFini' }, avecClip({ issue: 'mort' })), 'fin');
  });
  test('sans clip disponible, on livre directement', () => {
    const sans = avecClip({ issue: 'survie', aUnClipConsequence: false });
    assert.equal(transition('resolution', { type: 'resolu' }, sans), 'recompense');
  });
  test('le désaccord garde sa propre reprise', () => {
    assert.equal(transition('resolution', { type: 'resolu' }, avecClip({ issue: 'boucle' })), 'reprise');
  });
});

describe('peutRepondre / clipActif', () => {
  test('peutRepondre couvre choix/attente/absent/negociation', () => {
    assert.equal(peutRepondre('choix'), true);
    assert.equal(peutRepondre('attente'), true);
    assert.equal(peutRepondre('absent'), true);
    assert.equal(peutRepondre('negociation'), true);
    assert.equal(peutRepondre('scene'), false);
    assert.equal(peutRepondre('resolution'), false);
  });
  test('clipActif couvre scene/reprise/consequence', () => {
    assert.equal(clipActif('scene'), true);
    assert.equal(clipActif('reprise'), true);
    assert.equal(clipActif('consequence'), true);
    assert.equal(clipActif('choix'), false);
  });
});
