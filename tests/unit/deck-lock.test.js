'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Verrou de réciprocité photos appliqué à la PILE (réf Tinder, spec 16/07) :
// sans N photos soi-même, chaque carte du deck ne livre que les `visible`
// premières photos — le reste devient une slide « Débloquer les photos » côté
// front (flag photosVerrouillees + photosTotal). Serveur = incontournable :
// avant ça, le deck laissait feuilleter TOUTES les photos et contournait le
// verrou du profil consulté. Fonction PURE (zéro I/O).
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lockPhotos } = require('../../src/domain/deck');

const card = (id, n) => ({ id, photos: Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i}`, position: i })) });

test('viewer avec assez de photos (≥ required) : rien n\'est tronqué, flags posés quand même', () => {
  const out = lockPhotos([card('a', 6), card('b', 1)], { myPhotoCount: 2 });
  assert.equal(out[0].photos.length, 6);
  assert.equal(out[0].photosVerrouillees, false);
  assert.equal(out[0].photosTotal, 6);
  assert.equal(out[1].photosTotal, 1);
});

test('viewer sans assez de photos : tronqué aux 2 premières + flag + vrai total', () => {
  const out = lockPhotos([card('a', 6)], { myPhotoCount: 1 });
  assert.equal(out[0].photos.length, 2);
  assert.deepEqual(out[0].photos.map((p) => p.id), ['a-p0', 'a-p1'], 'les 2 PREMIÈRES (ordre respecté)');
  assert.equal(out[0].photosVerrouillees, true);
  assert.equal(out[0].photosTotal, 6, 'le vrai total pour le compteur de segments');
});

test('carte avec ≤ 2 photos : rien à cacher → jamais de slide verrouillée', () => {
  const out = lockPhotos([card('a', 2), card('b', 1), card('c', 0)], { myPhotoCount: 0 });
  for (const c of out) {
    assert.equal(c.photosVerrouillees, false, `${c.id} : pas de photo cachée = pas de verrou`);
  }
  assert.equal(out[0].photos.length, 2);
  assert.equal(out[1].photos.length, 1);
});

test('zéro photo soi-même : même règle qu\'une seule (le seuil est `required`)', () => {
  const out = lockPhotos([card('a', 5)], { myPhotoCount: 0 });
  assert.equal(out[0].photos.length, 2);
  assert.equal(out[0].photosVerrouillees, true);
});

test('required/visible surchargeables (config serveur)', () => {
  const out = lockPhotos([card('a', 5)], { myPhotoCount: 2, required: 4, visible: 3 });
  assert.equal(out[0].photos.length, 3, 'visible=3 → 3 photos servies');
  assert.equal(out[0].photosVerrouillees, true);
});

test('pureté : la liste source et ses cartes restent intactes', () => {
  const cards = [card('a', 5)];
  const snapshot = JSON.stringify(cards);
  lockPhotos(cards, { myPhotoCount: 0 });
  assert.equal(JSON.stringify(cards), snapshot);
});
