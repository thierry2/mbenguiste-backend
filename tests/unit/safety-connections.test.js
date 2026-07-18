'use strict';
// Logique PURE de l'écran « Signaler quelqu'un » (safety.service) : regrouper
// matchs actifs / matchs défaits / blocages en deux sections, dédupliquées et
// triées. Aucune I/O — les entrées sont les lignes brutes des tables.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPastConnections } = require('../../src/services/safety.service');

const ME = '00000000-0000-0000-0000-00000000000a';
const HER = '00000000-0000-0000-0000-00000000000b';
const HIM = '00000000-0000-0000-0000-00000000000c';

const profiles = new Map([
  [HER, { id: HER, prenom: 'Mariama', avatarUrl: 'https://x/m.jpg' }],
  [HIM, { id: HIM, prenom: 'David', avatarUrl: null }],
]);

const match = (other, over = {}) => ({
  id: `match-${other}`,
  user_low: ME < other ? ME : other,
  user_high: ME < other ? other : ME,
  created_at: '2026-07-02T10:00:00Z',
  ended_at: null,
  is_active: true,
  ...over,
});

test('un match actif va dans « en cours », avec le profil de l\'autre', () => {
  const out = buildPastConnections(ME, [match(HER)], [], profiles);
  assert.equal(out.enCours.length, 1);
  assert.equal(out.anciennes.length, 0);
  assert.deepEqual(out.enCours[0], {
    profileId: HER, matchId: `match-${HER}`, prenom: 'Mariama',
    avatarUrl: 'https://x/m.jpg', type: 'match', depuis: '2026-07-02T10:00:00Z',
  });
});

test('un match défait va dans « anciennes », type unmatch, daté par ended_at', () => {
  const rows = [match(HIM, { is_active: false, ended_at: '2026-06-12T08:00:00Z' })];
  const out = buildPastConnections(ME, rows, [], profiles);
  assert.equal(out.enCours.length, 0);
  assert.deepEqual(out.anciennes[0], {
    profileId: HIM, matchId: `match-${HIM}`, prenom: 'David',
    avatarUrl: null, type: 'unmatch', finLe: '2026-06-12T08:00:00Z',
  });
});

test('un unmatch d\'avant la migration (ended_at null) reste listé, sans date', () => {
  const rows = [match(HIM, { is_active: false })];
  const out = buildPastConnections(ME, rows, [], profiles);
  assert.equal(out.anciennes[0].type, 'unmatch');
  assert.equal(out.anciennes[0].finLe, null);
});

test('un blocage apparaît en « anciennes », type block, daté par le blocage', () => {
  const blocks = [{ blocked_id: HIM, created_at: '2026-05-18T09:00:00Z' }];
  const out = buildPastConnections(ME, [], blocks, profiles);
  assert.deepEqual(out.anciennes[0], {
    profileId: HIM, matchId: null, prenom: 'David',
    avatarUrl: null, type: 'block', finLe: '2026-05-18T09:00:00Z',
  });
});

test('bloqué APRÈS match : une seule entrée, le blocage l\'emporte (avec le matchId)', () => {
  // block() désactive aussi le match → la personne serait en double sinon.
  const rows = [match(HIM, { is_active: false, ended_at: '2026-05-18T09:00:00Z' })];
  const blocks = [{ blocked_id: HIM, created_at: '2026-05-18T09:00:01Z' }];
  const out = buildPastConnections(ME, rows, blocks, profiles);
  assert.equal(out.anciennes.length, 1);
  assert.equal(out.anciennes[0].type, 'block');
  assert.equal(out.anciennes[0].matchId, `match-${HIM}`);
});

test('tri : en cours par date de match desc, anciennes par date de fin desc (null en dernier)', () => {
  const p = new Map(profiles);
  const OLD = '00000000-0000-0000-0000-00000000000d';
  const NUL = '00000000-0000-0000-0000-00000000000e';
  p.set(OLD, { id: OLD, prenom: 'Kofi', avatarUrl: null });
  p.set(NUL, { id: NUL, prenom: 'Yann', avatarUrl: null });
  const rows = [
    match(HER, { created_at: '2026-06-26T10:00:00Z' }),
    match(HIM, { created_at: '2026-07-02T10:00:00Z' }),
    match(OLD, { is_active: false, ended_at: '2026-05-30T10:00:00Z' }),
    match(NUL, { is_active: false, ended_at: null }),
  ];
  const blocks = [{ blocked_id: '00000000-0000-0000-0000-00000000000f', created_at: '2026-06-12T10:00:00Z' }];
  p.set('00000000-0000-0000-0000-00000000000f', { id: '00000000-0000-0000-0000-00000000000f', prenom: 'Ali', avatarUrl: null });

  const out = buildPastConnections(ME, rows, blocks, p);
  assert.deepEqual(out.enCours.map((c) => c.prenom), ['David', 'Mariama']);
  assert.deepEqual(out.anciennes.map((c) => c.prenom), ['Ali', 'Kofi', 'Yann']);
});

test('un profil manquant (compte supprimé entre deux requêtes) est ignoré sans casser', () => {
  const rows = [match(HER), match(HIM, { is_active: false, ended_at: '2026-06-12T08:00:00Z' })];
  const out = buildPastConnections(ME, rows, [], new Map([[HER, profiles.get(HER)]]));
  assert.equal(out.enCours.length, 1);
  assert.equal(out.anciennes.length, 0);
});

// ── Garde-fou de consultation de profil ──────────────────────────────────────
// Un bloqué gardait l'accès à GET /profiles/:id : la découverte l'excluait, le
// chat était clos, mais l'API servait encore la fiche à qui avait l'identifiant.

const { isBlockedBetween } = require('../../src/services/safety.service');

test('blocage : je l\'ai bloqué → profil refusé', () => {
  assert.equal(isBlockedBetween([{ blocker_id: 'moi', blocked_id: 'lui' }], 'moi', 'lui'), true);
});

test('blocage : IL m\'a bloquée → profil refusé aussi (l\'autre sens compte)', () => {
  assert.equal(isBlockedBetween([{ blocker_id: 'lui', blocked_id: 'moi' }], 'moi', 'lui'), true);
});

test('aucun blocage entre les deux → profil servi', () => {
  assert.equal(isBlockedBetween([], 'moi', 'lui'), false);
});

test('un blocage qui ne concerne PAS la paire ne bloque rien', () => {
  assert.equal(isBlockedBetween([{ blocker_id: 'moi', blocked_id: 'tiers' }], 'moi', 'lui'), false);
});

test('mon propre profil reste toujours consultable', () => {
  assert.equal(isBlockedBetween([{ blocker_id: 'moi', blocked_id: 'moi' }], 'moi', 'moi'), false);
});
