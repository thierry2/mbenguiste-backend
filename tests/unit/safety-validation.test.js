// ─────────────────────────────────────────────────────────────────────────────
//  Contrat de validation du centre de sécurité — les bornes acceptées par le
//  serveur doivent être EXACTEMENT celles que l'écran laisse saisir
//  (src/lib/safety.ts : FREEFORM_MIN 20, FREEFORM_MAX 2000). Un écart ici se
//  paie en 400 sur un récit déjà écrit — le pire moment pour perdre un texte.
// ─────────────────────────────────────────────────────────────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');

const { report, freeformReport } = require('../../src/validations/profile.validation');
const { REPORT_DETAILS_MAX, FREEFORM_MIN, FREEFORM_MAX } = require('../../src/constants/safety');

const UUID = '11111111-1111-4111-8111-111111111111';
const parseReport = (body) => report.safeParse({ params: { id: UUID }, body });

test('signalement : le motif seul suffit (récit facultatif)', () => {
  assert.equal(parseReport({ reason: 'scam' }).success, true);
});

test('signalement : un récit de 2000 caractères passe — même borne que l\'écran', () => {
  assert.equal(parseReport({ reason: 'offline_behavior', details: 'a'.repeat(2000) }).success, true);
});

test('signalement : au-delà de 2000, refus net', () => {
  assert.equal(parseReport({ reason: 'offline_behavior', details: 'a'.repeat(2001) }).success, false);
});

test('signalement : sans motif, refus', () => {
  assert.equal(parseReport({ details: 'un texte' }).success, false);
});

test('dossier libre : moins de 20 caractères refusé, 20 accepté', () => {
  assert.equal(freeformReport.safeParse({ body: { body: 'a'.repeat(19) } }).success, false);
  assert.equal(freeformReport.safeParse({ body: { body: 'a'.repeat(20) } }).success, true);
});

test('dossier libre : les espaces ne comptent pas dans le minimum', () => {
  assert.equal(freeformReport.safeParse({ body: { body: `  ${'a'.repeat(19)}  ` } }).success, false);
});

test('dossier libre : borné à 2000 comme la contrainte SQL', () => {
  assert.equal(freeformReport.safeParse({ body: { body: 'a'.repeat(2000) } }).success, true);
  assert.equal(freeformReport.safeParse({ body: { body: 'a'.repeat(2001) } }).success, false);
});

// ── Anti-dérive : la borne ne doit exister qu'à UN endroit ───────────────────
// Le bug d'origine : zod acceptait 2000, le modèle tronquait à 1000 en silence.
// Ces tests échouent si l'une des deux couches redevient autonome.

test('les constantes valent bien ce que les écrans supposent', () => {
  assert.equal(REPORT_DETAILS_MAX, 2000);
  assert.equal(FREEFORM_MIN, 20);
  assert.equal(FREEFORM_MAX, 2000);
});

test('le modèle ne tronque JAMAIS en deçà de ce que la validation accepte', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/models/moderation.model.js'), 'utf8',
  );
  // Aucune longueur codée en dur : la seule borne autorisée vient des constantes.
  const enDur = source.match(/slice\(\s*0\s*,\s*\d+\s*\)/g) || [];
  assert.deepEqual(enDur, [], `Borne codée en dur dans le modèle : ${enDur.join(', ')}`);
});

test('la validation accepte exactement REPORT_DETAILS_MAX caractères', () => {
  assert.equal(parseReport({ reason: 'scam', details: 'a'.repeat(REPORT_DETAILS_MAX) }).success, true);
  assert.equal(parseReport({ reason: 'scam', details: 'a'.repeat(REPORT_DETAILS_MAX + 1) }).success, false);
});
