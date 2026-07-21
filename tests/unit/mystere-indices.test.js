'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// INDICES RÉELS (domaine pur) — `attributsIndices` dérive du profil du
// partenaire les valeurs à dévoiler pendant l'aventure. Règles produit :
//   · pas d'info → null (on n'affiche rien) ;
//   · JAMAIS la photo ici (le visage se sert après le match) ;
//   · `gout` = le 1er intérêt, `interets` = la liste complète (carte progressive) ;
//   · `aveu` = le 1er prompt RÉPONDU, dans l'ordre `position`.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attributsIndices } = require('../../src/domain/mystere');

const profilComplet = {
  first_name: '  Aïcha ',
  current_city: ' Douala ',
  interests: [
    { interest: { code: 'afro', display_name: 'Afrobeats' } },
    { interest: { code: 'ciné', display_name: 'Cinéma' } },
  ],
  prompts: [
    { position: 2, answer: 'Le deuxième', prompt: { question: 'Q2 ?' } },
    { position: 1, answer: "  Je n'ai jamais su dire non  ", prompt: { question: 'Ton aveu ?' } },
  ],
};

test('profil complet : toutes les valeurs, trimées', () => {
  const r = attributsIndices(profilComplet, 26);
  assert.equal(r.prenom, 'Aïcha');
  assert.equal(r.age, 26);
  assert.equal(r.ville, 'Douala');
  assert.equal(r.gout, 'Afrobeats');
  assert.deepEqual(r.interets, ['Afrobeats', 'Cinéma']);
  assert.deepEqual(r.aveu, { question: 'Ton aveu ?', answer: "Je n'ai jamais su dire non" });
});

test('aveu = le 1er prompt RÉPONDU par position (pas l’ordre du tableau)', () => {
  const r = attributsIndices(profilComplet, 26);
  assert.equal(r.aveu.answer, "Je n'ai jamais su dire non"); // position 1, alors qu'il est 2e dans le tableau
});

test('prompt sans réponse ignoré → aveu = le suivant répondu', () => {
  const r = attributsIndices({
    prompts: [
      { position: 1, answer: '   ', prompt: { question: 'Vide ?' } },
      { position: 2, answer: 'Vrai aveu', prompt: { question: 'Q ?' } },
    ],
  });
  assert.deepEqual(r.aveu, { question: 'Q ?', answer: 'Vrai aveu' });
});

test('champs manquants → null (on n’affiche rien)', () => {
  const r = attributsIndices({}, null);
  assert.equal(r.prenom, null);
  assert.equal(r.age, null);
  assert.equal(r.ville, null);
  assert.equal(r.gout, null);
  assert.deepEqual(r.interets, []);
  assert.equal(r.aveu, null);
});

test('âge invalide (0, NaN, négatif) → null', () => {
  assert.equal(attributsIndices({}, 0).age, null);
  assert.equal(attributsIndices({}, NaN).age, null);
  assert.equal(attributsIndices({}, -3).age, null);
});

test('aucun prompt répondu → aveu null', () => {
  const r = attributsIndices({ prompts: [{ position: 1, answer: '', prompt: { question: 'Q' } }] });
  assert.equal(r.aveu, null);
});

test('intérêts vides/malformés filtrés', () => {
  const r = attributsIndices({
    interests: [{ interest: { display_name: '  ' } }, { interest: null }, { interest: { display_name: 'Danse' } }],
  });
  assert.deepEqual(r.interets, ['Danse']);
  assert.equal(r.gout, 'Danse');
});

test('JAMAIS de photo/avatar dans la sortie', () => {
  const r = attributsIndices({ first_name: 'X', avatar_url: 'http://secret/face.jpg' }, 30);
  assert.equal('avatar_url' in r, false);
  assert.equal('photo' in r, false);
});
