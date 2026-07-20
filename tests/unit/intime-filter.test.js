'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Le filtre SERVEUR du message intime. Deux exigences de bout en bout :
//   1. on ne laisse JAMAIS fuiter un moyen de contact (sur-filtrer > sous-filtrer) ;
//   2. on ne massacre PAS un vrai message (âges, heures, années, « snap » nom
//      commun) → pas de faux positifs.
// Miroir des tests front (frontend/src/lib/__tests__/intimateFilter.test.ts).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filtrerMessageIntime } = require('../../src/domain/intimeFilter');

test('laisse passer un vrai message intime', () => {
  const innocents = [
    'J’ai adoré ta réponse, tu m’intrigues vraiment.',
    'J’ai 25 ans et deux petites sœurs.',
    'On se retrouve à 21 h 30 devant le cinéma ?',
    'Je suis né en 2001, l’année du serpent.',
    'Ce snap de coucher de soleil m’a fait penser à toi.',
    'J’ai gagné 100 000 fois à ce jeu, promis.',
    'Un, deux, trois… on saute ensemble ?',
  ];
  for (const msg of innocents) {
    const r = filtrerMessageIntime(msg);
    assert.equal(r.flagged, false, `ne devrait pas flaguer : ${msg}`);
    assert.deepEqual(r.reasons, []);
    assert.equal(r.clean, msg);
  }
});

test('retire les numéros de téléphone (formats variés)', () => {
  const numeros = [
    'Appelle-moi au 0612345678',
    'mon num c’est 06 12 34 56 78',
    '06.12.34.56.78 à ce soir',
    '06-12-34-56-78',
    '+33 6 12 34 56 78',
    'écris sur +237 6 90 12 34 56',
  ];
  for (const msg of numeros) {
    const r = filtrerMessageIntime(msg);
    assert.equal(r.flagged, true, msg);
    assert.ok(r.reasons.includes('phone'), msg);
    assert.doesNotMatch(r.clean, /\d{4}/, `un numéro a fuité : ${r.clean}`);
    assert.ok(r.clean.includes('•••'));
  }
});

test('un numéro épelé en toutes lettres est aussi attrapé', () => {
  const r = filtrerMessageIntime('zéro six zéro un deux trois quatre cinq six sept');
  assert.equal(r.flagged, true);
  assert.ok(r.reasons.includes('phone'));
});

test('e-mails, @handles, pseudos réseau', () => {
  const email = filtrerMessageIntime('mon mail : bella.diallo@gmail.com si tu veux');
  assert.ok(email.reasons.includes('email'));
  assert.doesNotMatch(email.clean, /bella\.diallo|@gmail/);

  const handle = filtrerMessageIntime('suis-moi @bella_92 partout');
  assert.ok(handle.reasons.includes('handle'));
  assert.ok(!handle.clean.includes('@bella_92'));

  const snap = filtrerMessageIntime('mon snap c’est bella_92, ajoute-moi');
  assert.ok(snap.reasons.includes('social'));
  assert.ok(!snap.clean.includes('bella_92'));

  const insta = filtrerMessageIntime('insta: bella.diallo je poste tout là');
  assert.ok(insta.reasons.includes('social'));
  assert.ok(!insta.clean.includes('bella.diallo'));
});

test('« instagram » sujet de phrase n’est PAS confondu avec un handle', () => {
  const r = filtrerMessageIntime('je passe ma vie sur instagram tous les jours');
  assert.equal(r.flagged, false);
  assert.equal(r.clean, 'je passe ma vie sur instagram tous les jours');
});

test('URL wa.me / t.me retirée en entier', () => {
  const r = filtrerMessageIntime('rejoins https://wa.me/237690123456 vite');
  assert.ok(r.reasons.includes('url'));
  assert.ok(!r.clean.includes('wa.me'));
});

test('robustesse : vide, multi-vecteurs, dédup, jamais « •••••• »', () => {
  assert.deepEqual(filtrerMessageIntime(''), { clean: '', flagged: false, reasons: [] });

  const multi = filtrerMessageIntime('06 12 34 56 78 ou mail bella@x.com ou snap: bella_92');
  assert.equal(multi.flagged, true);
  for (const k of ['phone', 'email', 'social']) assert.ok(multi.reasons.includes(k), k);
  assert.doesNotMatch(multi.clean, /\d{4}/);
  assert.ok(!multi.clean.includes('bella@x.com'));

  const dup = filtrerMessageIntime('0612345678 et aussi 0798765432');
  assert.equal(dup.reasons.filter((x) => x === 'phone').length, 1);

  const one = filtrerMessageIntime('06 12 34 56 78');
  assert.doesNotMatch(one.clean, /•\s*•\s*•\s*•/);
});
