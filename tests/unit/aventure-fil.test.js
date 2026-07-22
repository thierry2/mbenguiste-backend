'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE FIL DE L'AVENTURE VERSÉ DANS LA CONVERSATION.
//
// Au match, la conversation ne s'ouvre plus vide : elle s'ouvre sur CE QUE LES
// DEUX SE SONT DÉJÀ ÉCRIT pendant l'Aventure — l'aveu du nœud intime et les
// messages de négociation. Ils ont été écrits sous anonymat ; ils reprennent ici
// leur auteur réel, dans l'ordre où ils ont été dits.
//
// Ce module est PUR : il transforme des lignes `aventure_answers` en lignes
// `messages`. Aucune I/O — c'est ce qui le rend testable au cas près.
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { messagesDuFil } = require('../../src/domain/aventureFil');

const PAIR = { user_low: 'U-A', user_high: 'U-B' };
const M = 'MATCH-1';

const ligne = (over = {}) => ({
  node_id: 'n4', role: 'a', answer_index: null,
  message_text: 'un aveu', created_at: '2026-07-22T10:00:00.000Z', ...over,
});

describe('messagesDuFil — le fil devient la conversation', () => {
  test('un aveu devient un message de son auteur réel', () => {
    const out = messagesDuFil({ rows: [ligne()], pair: PAIR, matchId: M });
    assert.deepEqual(out, [{
      match_id: M, sender_id: 'U-A', body: 'un aveu',
      created_at: '2026-07-22T10:00:00.000Z',
    }]);
  });

  test('rôle a → user_low, rôle b → user_high', () => {
    const out = messagesDuFil({
      rows: [ligne({ role: 'a', message_text: 'moi' }), ligne({ role: 'b', message_text: 'elle', node_id: 'n4b' })],
      pair: PAIR, matchId: M,
    });
    assert.deepEqual(out.map((m) => m.sender_id), ['U-A', 'U-B']);
  });

  test('les CHOIX A/B ne sont PAS des messages — seul le texte compte', () => {
    // Une épreuve enregistre un `answer_index` sans texte : la verser dans le
    // fil produirait des messages vides, ou pire, « 0 » et « 1 ».
    const rows = [
      ligne({ node_id: 'n1', message_text: null, answer_index: 0 }),
      ligne({ node_id: 'n2', message_text: '   ', answer_index: 1 }),
      ligne({ node_id: 'n4', message_text: 'le vrai aveu' }),
    ];
    const out = messagesDuFil({ rows, pair: PAIR, matchId: M });
    assert.equal(out.length, 1);
    assert.equal(out[0].body, 'le vrai aveu');
  });

  test('ORDRE CHRONOLOGIQUE, quel que soit l’ordre d’arrivée des lignes', () => {
    const rows = [
      ligne({ message_text: 'troisième', created_at: '2026-07-22T12:00:00.000Z' }),
      ligne({ message_text: 'premier', created_at: '2026-07-22T10:00:00.000Z', node_id: 'x' }),
      ligne({ message_text: 'deuxième', created_at: '2026-07-22T11:00:00.000Z', node_id: 'y' }),
    ];
    const out = messagesDuFil({ rows, pair: PAIR, matchId: M });
    assert.deepEqual(out.map((m) => m.body), ['premier', 'deuxième', 'troisième']);
  });

  test('l’horodatage D’ORIGINE est conservé — ces mots datent d’AVANT le match', () => {
    // Tout insérer à `now()` écraserait la chronologie : les messages de
    // négociation du début se retrouveraient mêlés à l'aveu de la fin.
    const out = messagesDuFil({ rows: [ligne()], pair: PAIR, matchId: M });
    assert.equal(out[0].created_at, '2026-07-22T10:00:00.000Z');
  });

  test('les messages de NÉGOCIATION comptent aussi (canal, pas un vrai nœud)', () => {
    const out = messagesDuFil({
      rows: [ligne({ node_id: 'n1::negoc::2', message_text: 'je tiens à mon choix' })],
      pair: PAIR, matchId: M,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].body, 'je tiens à mon choix');
  });

  test('un rôle inconnu est ÉCARTÉ — jamais de message sans auteur', () => {
    // `sender_id` est NOT NULL en base : une ligne douteuse ferait échouer TOUT
    // l'insert, et la conversation s'ouvrirait vide sans qu'on sache pourquoi.
    const out = messagesDuFil({
      rows: [ligne({ role: 'c' }), ligne({ role: null, node_id: 'z' })],
      pair: PAIR, matchId: M,
    });
    assert.deepEqual(out, []);
  });

  test('paire incomplète ou absente → rien, aucune exception', () => {
    for (const pair of [null, undefined, {}, { user_low: 'U-A' }]) {
      const out = messagesDuFil({ rows: [ligne({ role: 'b' })], pair, matchId: M });
      assert.deepEqual(out, []);
    }
  });

  test('entrées corrompues (rows non-tableau, lignes nulles) → aucune exception', () => {
    for (const rows of [null, undefined, 'x', 42, {}]) {
      assert.deepEqual(messagesDuFil({ rows, pair: PAIR, matchId: M }), []);
    }
    assert.deepEqual(messagesDuFil({ rows: [null, undefined], pair: PAIR, matchId: M }), []);
  });

  test('le texte est TRIMÉ mais jamais réécrit — c’est leur parole', () => {
    const out = messagesDuFil({
      rows: [ligne({ message_text: '  Que je ne me sens jamais à ma place.  ' })],
      pair: PAIR, matchId: M,
    });
    assert.equal(out[0].body, 'Que je ne me sens jamais à ma place.');
  });

  test('sans matchId → rien (on n’insère pas dans une conversation inconnue)', () => {
    assert.deepEqual(messagesDuFil({ rows: [ligne()], pair: PAIR, matchId: null }), []);
  });
});
