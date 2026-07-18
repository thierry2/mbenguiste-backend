'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultCode } = require('../../src/services/partnerAdmin.service');

test('defaultCode : 1er mot du nom, MAJUSCULES alphanumériques', () => {
  assert.equal(defaultCode('Aminata Diallo'), 'AMINATA');
  assert.equal(defaultCode('  koffi '), 'KOFFI');
  assert.equal(defaultCode("N'Guessan Marie"), 'NGUESSAN');
  assert.equal(defaultCode(''), 'PARTENAIRE');
});
