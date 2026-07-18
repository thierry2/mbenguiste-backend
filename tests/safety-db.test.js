'use strict';
// Centre de sécurité — contrats DB (migration 024) sur le VRAI schema.sql :
//  • motifs de signalement v2 (9 codes, ordre d'affichage, libellés renommés) ;
//  • matches.ended_at : l'unmatch reste un soft delete, désormais DATÉ (l'écran
//    « Anciennes connexions » affiche « Match défait le … ») ;
//  • freeform_reports : dossier libre quand le profil n'apparaît plus nulle part.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, swipe, matchesBetween } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });

// ── Motifs v2 ────────────────────────────────────────────────────────────────

test('motifs v2 : les 9 codes attendus, dans l\'ordre d\'affichage', async () => {
  const res = await db.query('select code from report_reasons order by display_order, code');
  assert.deepEqual(
    res.rows.map((r) => r.code),
    ['scam', 'fake', 'harassment', 'threats', 'inappropriate', 'hate', 'offline_behavior', 'underage', 'other'],
  );
});

test('motifs v2 : libellés alignés sur les maquettes (codes historiques renommés)', async () => {
  const res = await db.query('select code, display_name from report_reasons');
  const byCode = Object.fromEntries(res.rows.map((r) => [r.code, r.display_name]));
  assert.equal(byCode.scam, 'Demande d\'argent ou arnaque');
  assert.equal(byCode.fake, 'Faux profil ou usurpation');
  assert.equal(byCode.harassment, 'Harcèlement ou insistance');
  assert.equal(byCode.threats, 'Menaces ou violence');
  assert.equal(byCode.inappropriate, 'Contenu sexuel non sollicité');
  assert.equal(byCode.hate, 'Propos haineux');
  assert.equal(byCode.offline_behavior, 'Une rencontre en personne');
  assert.equal(byCode.underage, 'Personne mineure');
  assert.equal(byCode.other, 'Autre chose');
});

test('un signalement accepte les nouveaux motifs (FK reason_id)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await db.query(
    `insert into reports (reporter_id, reported_id, reason_id)
     values ($1::uuid, $2::uuid, (select id from report_reasons where code = 'offline_behavior'))`,
    [a, b],
  );
  const res = await db.query(
    `select r.status, rr.code from reports r join report_reasons rr on rr.id = r.reason_id
     where r.reporter_id = $1::uuid`, [a],
  );
  assert.equal(res.rows[0].code, 'offline_behavior');
  assert.equal(res.rows[0].status, 'open');
});

// ── ended_at : le soft delete daté ───────────────────────────────────────────

test('unmatch daté : la ligne matches survit, ended_at posé', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like'); await swipe(db, b, a, 'like');
  const [m] = await matchesBetween(db, a, b);
  assert.equal(m.is_active, true);

  await db.query('update matches set is_active = false, ended_at = now() where id = $1::uuid', [m.id]);
  const res = await db.query('select is_active, ended_at from matches where id = $1::uuid', [m.id]);
  assert.equal(res.rows[0].is_active, false);
  assert.ok(res.rows[0].ended_at, 'ended_at doit être posé au moment de l\'unmatch');
});

test('les matchs historiques déjà inactifs restent lisibles (ended_at null toléré)', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await swipe(db, a, b, 'like'); await swipe(db, b, a, 'like');
  const [m] = await matchesBetween(db, a, b);
  // Un unmatch d'avant la migration : is_active=false sans date.
  await db.query('update matches set is_active = false where id = $1::uuid', [m.id]);
  const res = await db.query('select ended_at from matches where id = $1::uuid and is_active = false', [m.id]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].ended_at, null);
});

// ── freeform_reports ─────────────────────────────────────────────────────────

test('dossier libre : insertion, statut open par défaut', async () => {
  const a = await addUser(db);
  await db.query(
    'insert into freeform_reports (reporter_id, body) values ($1::uuid, $2)',
    [a, 'Il s\'appelait David, on a matché fin mai puis il a défait le match après m\'avoir insultée.'],
  );
  const res = await db.query('select status, body from freeform_reports where reporter_id = $1::uuid', [a]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].status, 'open');
});

test('dossier libre : un texte trop court est rejeté (contrainte de longueur)', async () => {
  const a = await addUser(db);
  await assert.rejects(
    () => db.query('insert into freeform_reports (reporter_id, body) values ($1::uuid, $2)', [a, 'trop court']),
    /chk_freeform_body_len/,
  );
});

test('dossier libre : supprimé en cascade avec le profil du signaleur', async () => {
  const a = await addUser(db);
  await db.query(
    'insert into freeform_reports (reporter_id, body) values ($1::uuid, $2)',
    [a, 'Un profil qui a disparu de mes conversations mais que je dois signaler quand même.'],
  );
  await db.query('delete from profiles where id = $1::uuid', [a]);
  const res = await db.query('select id from freeform_reports where reporter_id = $1::uuid', [a]);
  assert.equal(res.rows.length, 0);
});

// ── Console de modération (migration 025) ────────────────────────────────────

test('traçabilité : un dossier peut être clos avec action et note', async () => {
  const a = await addUser(db); const b = await addUser(db);
  await db.query(
    `insert into reports (reporter_id, reported_id, reason_id)
     values ($1::uuid, $2::uuid, (select id from report_reasons where code = 'scam'))`,
    [a, b],
  );
  await db.query(
    `update reports set status = 'closed', admin_action = 'retirer',
       admin_note = 'Profil retiré, 3 signalantes', treated_at = now()
     where reported_id = $1::uuid and status = 'open'`, [b],
  );
  const res = await db.query(
    'select status, admin_action, admin_note, treated_at from reports where reported_id = $1::uuid', [b],
  );
  assert.equal(res.rows[0].status, 'closed');
  assert.equal(res.rows[0].admin_action, 'retirer');
  assert.ok(res.rows[0].treated_at);
});

test('clore libère la paire : la personne peut re-signaler si ça recommence', async () => {
  const a = await addUser(db); const b = await addUser(db);
  const insert = () => db.query(
    `insert into reports (reporter_id, reported_id, reason_id)
     values ($1::uuid, $2::uuid, (select id from report_reasons where code = 'harassment'))`,
    [a, b],
  );
  await insert();
  // Tant que le dossier est ouvert, l'index unique interdit le doublon.
  await assert.rejects(insert);
  await db.query(`update reports set status = 'closed' where reported_id = $1::uuid`, [b]);
  // Une fois clos, un nouveau dossier redevient possible.
  await insert();
  const res = await db.query('select count(*)::int as n from reports where reported_id = $1::uuid', [b]);
  assert.equal(res.rows[0].n, 2);
});

test('dossier libre : traçable lui aussi', async () => {
  const a = await addUser(db);
  await db.query(
    `insert into freeform_reports (reporter_id, body, admin_action, admin_note, treated_at, status)
     values ($1::uuid, $2, 'rejeter', 'Aucun profil retrouvé', now(), 'closed')`,
    [a, 'Un homme rencontré en mars, prénom Karim, ville de Lyon.'],
  );
  const res = await db.query('select status, admin_action from freeform_reports where reporter_id = $1::uuid', [a]);
  assert.equal(res.rows[0].status, 'closed');
  assert.equal(res.rows[0].admin_action, 'rejeter');
});
