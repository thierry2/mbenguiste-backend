'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB de la télémétrie deck (migration 018, reflétée dans schema.sql) :
//  - `ingest_deck_events` : ingestion ATOMIQUE d'un batch (événements bruts +
//    agrégats dans la même transaction), idempotente par (viewer, client_ref) —
//    un retry réseau du même batch ne double JAMAIS un compteur ;
//  - agrégats : card_impression nourrit profile_engagement (impressions, dwell)
//    ET deck_impressions (rotation par paire) ; profile_open nourrit les
//    ouvertures ; section/photo_view n'agrègent RIEN (réservoir V2) ;
//  - trigger swipes → likes/passes reçus (source de vérité unique : la table
//    swipes couvre deck + picks + likes ciblés) ;
//  - RLS : tout est FERMÉ au client (écriture ET lecture backend service_role
//    only — l'engagement d'un profil ne regarde personne d'autre).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, swipe, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

/** Appelle le RPC comme le ferait supabase.rpc() — renvoie le nombre accepté. */
async function ingest(viewerId, events) {
  const { rows } = await db.query(
    'select public.ingest_deck_events($1::uuid, $2::jsonb) as accepted',
    [viewerId, JSON.stringify(events)],
  );
  return rows[0].accepted;
}

async function engagementOf(profileId) {
  const { rows } = await db.query(
    'select * from profile_engagement where profile_id = $1::uuid', [profileId],
  );
  return rows[0] ?? null;
}

async function impressionsOf(viewerId, targetId) {
  const { rows } = await db.query(
    'select * from deck_impressions where viewer_id = $1::uuid and target_id = $2::uuid',
    [viewerId, targetId],
  );
  return rows[0] ?? null;
}

// ── Ingestion & idempotence ──────────────────────────────────────────────────

test('ingest : un batch mixte est accepté en entier, les événements bruts sont écrits', async () => {
  const viewer = await addUser(db, { firstName: 'Awa' });
  const target = await addUser(db, { firstName: 'Bineta' });

  const accepted = await ingest(viewer, [
    { targetId: target, kind: 'card_impression', dwellMs: 4200, clientRef: 'ref-a1', payload: { photosViewed: 3, photoCount: 5, entryRank: 2, action: 'like' } },
    { targetId: target, kind: 'profile_open', clientRef: 'ref-a2', payload: { src: 'discover' } },
    { targetId: target, kind: 'profile_section_view', dwellMs: 1800, clientRef: 'ref-a3', payload: { section: 'rythmes' } },
  ]);
  assert.equal(accepted, 3);

  const { rows } = await db.query(
    'select kind, dwell_ms, payload from deck_events where viewer_id = $1::uuid order by id', [viewer],
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'card_impression');
  assert.equal(rows[0].dwell_ms, 4200);
  assert.equal(rows[0].payload.photosViewed, 3);
  assert.equal(rows[1].kind, 'profile_open');
  assert.equal(rows[1].dwell_ms, null);
});

test('ingest : rejouer le MÊME batch (mêmes clientRef) → 0 accepté, agrégats non re-comptés', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  const batch = [
    { targetId: target, kind: 'card_impression', dwellMs: 3000, clientRef: 'ref-b1', payload: {} },
    { targetId: target, kind: 'profile_open', clientRef: 'ref-b2', payload: { src: 'discover' } },
  ];

  assert.equal(await ingest(viewer, batch), 2);
  assert.equal(await ingest(viewer, batch), 0, 'le retry réseau du même batch est un no-op');

  const eng = await engagementOf(target);
  assert.equal(eng.impressions, 1, 'une seule impression malgré le double envoi');
  assert.equal(Number(eng.dwell_ms_total), 3000);
  assert.equal(eng.profile_opens, 1);
  const imp = await impressionsOf(viewer, target);
  assert.equal(imp.seen_count, 1);
});

test('ingest : un batch partiellement rejoué n\'accepte que les événements NOUVEAUX', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [
    { targetId: target, kind: 'card_impression', dwellMs: 1000, clientRef: 'ref-c1', payload: {} },
  ]);
  // Le client re-envoie l'ancien (succès partiel non confirmé) + un nouveau.
  const accepted = await ingest(viewer, [
    { targetId: target, kind: 'card_impression', dwellMs: 1000, clientRef: 'ref-c1', payload: {} },
    { targetId: target, kind: 'card_impression', dwellMs: 2000, clientRef: 'ref-c2', payload: {} },
  ]);
  assert.equal(accepted, 1);
  const eng = await engagementOf(target);
  assert.equal(eng.impressions, 2);
  assert.equal(Number(eng.dwell_ms_total), 3000);
  assert.equal((await impressionsOf(viewer, target)).seen_count, 2);
});

test('ingest : le même clientRef chez DEUX viewers différents compte deux fois (l\'idempotence est par viewer)', async () => {
  const v1 = await addUser(db);
  const v2 = await addUser(db);
  const target = await addUser(db);
  const ev = { targetId: target, kind: 'card_impression', dwellMs: 500, clientRef: 'ref-shared', payload: {} };
  assert.equal(await ingest(v1, [ev]), 1);
  assert.equal(await ingest(v2, [ev]), 1);
  assert.equal((await engagementOf(target)).impressions, 2);
});

// ── Agrégats par kind ────────────────────────────────────────────────────────

test('card_impression : bump impressions + dwell_ms_total ET la rotation (viewer, target)', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [
    { targetId: target, kind: 'card_impression', dwellMs: 2500, clientRef: 'ref-d1', payload: {} },
    { targetId: target, kind: 'card_impression', dwellMs: 1500, clientRef: 'ref-d2', payload: {} },
  ]);
  const eng = await engagementOf(target);
  assert.equal(eng.impressions, 2);
  assert.equal(Number(eng.dwell_ms_total), 4000);
  assert.equal(eng.profile_opens, 0);
  const imp = await impressionsOf(viewer, target);
  assert.equal(imp.seen_count, 2);
  assert.ok(imp.last_seen_at, 'la rotation date la dernière vue');
});

test('card_impression sans dwellMs : compte l\'impression, dwell à 0 (jamais de null qui casse la somme)', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [{ targetId: target, kind: 'card_impression', clientRef: 'ref-e1', payload: {} }]);
  const eng = await engagementOf(target);
  assert.equal(eng.impressions, 1);
  assert.equal(Number(eng.dwell_ms_total), 0);
});

test('profile_open : bump profile_opens SEUL (ni impression, ni rotation)', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [{ targetId: target, kind: 'profile_open', clientRef: 'ref-f1', payload: { src: 'discover' } }]);
  const eng = await engagementOf(target);
  assert.equal(eng.profile_opens, 1);
  assert.equal(eng.impressions, 0);
  assert.equal(await impressionsOf(viewer, target), null, 'ouvrir un profil n\'est pas une exposition de carte');
});

test('profile_section_view / profile_photo_view : bruts SEULEMENT, aucun agrégat (réservoir V2)', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [
    { targetId: target, kind: 'profile_section_view', dwellMs: 3000, clientRef: 'ref-g1', payload: { section: 'vie' } },
    { targetId: target, kind: 'profile_photo_view', clientRef: 'ref-g2', payload: { position: 2 } },
  ]);
  assert.equal(await engagementOf(target), null, 'aucune ligne d\'agrégat créée');
  assert.equal(await impressionsOf(viewer, target), null);
  const { rows } = await db.query('select count(*)::int as n from deck_events where viewer_id = $1::uuid', [viewer]);
  assert.equal(rows[0].n, 2, 'les bruts sont bien là pour la V2');
});

// ── Trigger swipes → likes/passes reçus ──────────────────────────────────────

test('trigger swipes : like et super_like comptent en likes_received, pass en passes_received', async () => {
  const a = await addUser(db);
  const b = await addUser(db);
  const c = await addUser(db);
  const target = await addUser(db);

  await swipe(db, a, target, 'like');
  await swipe(db, b, target, 'super_like');
  await swipe(db, c, target, 'pass');

  const eng = await engagementOf(target);
  assert.equal(eng.likes_received, 2, 'le super_like est un like au sens du taux');
  assert.equal(eng.passes_received, 1);
});

test('trigger swipes : coexiste avec les agrégats d\'ingestion sur la même ligne', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [{ targetId: target, kind: 'card_impression', dwellMs: 2000, clientRef: 'ref-h1', payload: {} }]);
  await swipe(db, viewer, target, 'like');
  const eng = await engagementOf(target);
  assert.equal(eng.impressions, 1);
  assert.equal(eng.likes_received, 1);
});

// ── Contraintes ──────────────────────────────────────────────────────────────

test('self-event : rejeté par contrainte (on ne s\'auto-mesure pas)', async () => {
  const a = await addUser(db);
  await assert.rejects(
    () => db.query(
      `insert into deck_events (viewer_id, target_id, kind, client_ref)
       values ($1::uuid, $1::uuid, 'card_impression', 'ref-self')`, [a],
    ),
  );
});

test('kind inconnu et dwell négatif ou délirant : rejetés par check', async () => {
  const a = await addUser(db);
  const b = await addUser(db);
  await assert.rejects(() => db.query(
    `insert into deck_events (viewer_id, target_id, kind, client_ref)
     values ($1::uuid, $2::uuid, 'mega_event', 'ref-k1')`, [a, b],
  ), /check/i);
  await assert.rejects(() => db.query(
    `insert into deck_events (viewer_id, target_id, kind, dwell_ms, client_ref)
     values ($1::uuid, $2::uuid, 'card_impression', -5, 'ref-k2')`, [a, b],
  ), /check/i);
  await assert.rejects(() => db.query(
    `insert into deck_events (viewer_id, target_id, kind, dwell_ms, client_ref)
     values ($1::uuid, $2::uuid, 'card_impression', 99999999, 'ref-k3')`, [a, b],
  ), /check/i);
});

// ── RLS : tout est fermé au client ───────────────────────────────────────────

test('RLS : un client ne lit RIEN (événements, engagement, rotation) — même les siens', async () => {
  const viewer = await addUser(db);
  const target = await addUser(db);
  await ingest(viewer, [{ targetId: target, kind: 'card_impression', dwellMs: 1000, clientRef: 'ref-r1', payload: {} }]);

  const events = await asUser(db, viewer, () => db.query('select * from deck_events'));
  assert.equal(events.rows.length, 0, 'les événements bruts sont invisibles côté client');

  const eng = await asUser(db, target, () => db.query('select * from profile_engagement'));
  assert.equal(eng.rows.length, 0, 'son propre engagement reste opaque (pas de reverse-engineering du ranking)');

  const imp = await asUser(db, viewer, () => db.query('select * from deck_impressions'));
  assert.equal(imp.rows.length, 0);
});

test('RLS : un client ne peut PAS écrire (ni événements directs, ni agrégats forgés)', async () => {
  const a = await addUser(db);
  const b = await addUser(db);
  await assert.rejects(
    () => asUser(db, a, () => db.query(
      `insert into deck_events (viewer_id, target_id, kind, client_ref)
       values ($1::uuid, $2::uuid, 'card_impression', 'ref-w1')`, [a, b],
    )),
    'aucune policy INSERT → écriture refusée par RLS',
  );
  await assert.rejects(
    () => asUser(db, a, () => db.query(
      'insert into profile_engagement (profile_id, likes_received) values ($1::uuid, 9999)', [a],
    )),
    'personne ne gonfle son propre engagement',
  );
});
