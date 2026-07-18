'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Contrat DB du Programme Partenaires (migration 028, reflétée dans schema.sql) :
//  - partners : taux en points de base (défaut 3000 = 30 %), statut borné,
//    email unique ;
//  - promo_codes : le code EST la clé, rattaché à un partenaire (cascade) ;
//  - referrals : profile_id EN PK → UNE attribution par membre (le 1er code
//    gagne, jamais réécrit) = garde anti-fraude ;
//  - commission_ledger : event_id UNIQUE → idempotence du webhook (rejeu sans
//    doublon), statut borné ;
//  - RLS : tout FERMÉ au client (le portail lit via l'API service_role).
// ─────────────────────────────────────────────────────────────────────────────
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDb, addUser, asUser } = require('./helpers/db');

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close?.(); });

/** Insère un partenaire minimal et renvoie son id. */
async function addPartner(db, { name = 'Aminata', email = 'aminata@example.com', founder = false, rate } = {}) {
  const { rows } = await db.query(
    `insert into partners (display_name, email, is_founder ${rate != null ? ', rate_bps' : ''})
     values ($1, $2, $3 ${rate != null ? ', $4' : ''}) returning id`,
    rate != null ? [name, email, founder, rate] : [name, email, founder],
  );
  return rows[0].id;
}

test('partners : rate_bps par défaut = 3000 (30 %)', async () => {
  const id = await addPartner(db, { email: 'p-default@example.com' });
  const { rows } = await db.query('select rate_bps, status, is_founder from partners where id = $1::uuid', [id]);
  assert.equal(rows[0].rate_bps, 3000);
  assert.equal(rows[0].status, 'invited');
  assert.equal(rows[0].is_founder, false);
});

test('partners : statut borné (invited/active/frozen), rejette le reste', async () => {
  const id = await addPartner(db, { email: 'p-status@example.com' });
  for (const s of ['invited', 'active', 'frozen']) {
    await db.query('update partners set status = $1 where id = $2::uuid', [s, id]);
  }
  await assert.rejects(
    () => db.query("update partners set status = 'banni' where id = $1::uuid", [id]),
    'un statut inconnu doit être rejeté par la contrainte check',
  );
});

test('partners : email unique', async () => {
  await addPartner(db, { email: 'dup@example.com' });
  await assert.rejects(
    () => addPartner(db, { email: 'dup@example.com', name: 'Autre' }),
    'deux partenaires ne peuvent pas partager le même email',
  );
});

test('partners : rate_bps borné 0..10000', async () => {
  await assert.rejects(
    () => addPartner(db, { email: 'p-rate@example.com', rate: 12000 }),
    'un taux > 100 % doit être rejeté',
  );
});

test('promo_codes : rattaché à un partenaire, supprimé en cascade', async () => {
  const partnerId = await addPartner(db, { email: 'p-code@example.com' });
  await db.query("insert into promo_codes (code, partner_id) values ('AMINATA', $1::uuid)", [partnerId]);

  // Code déjà pris → PK rejette.
  await assert.rejects(
    () => db.query("insert into promo_codes (code, partner_id) values ('AMINATA', $1::uuid)", [partnerId]),
    'le code est la clé primaire : pas de doublon',
  );

  // Suppression du partenaire → le code disparaît (cascade).
  await db.query('delete from partners where id = $1::uuid', [partnerId]);
  const { rows } = await db.query("select 1 from promo_codes where code = 'AMINATA'");
  assert.equal(rows.length, 0);
});

test('referrals : profile_id en PK → une seule attribution par membre (le 1er code gagne)', async () => {
  const partnerId = await addPartner(db, { email: 'p-ref@example.com' });
  await db.query("insert into promo_codes (code, partner_id) values ('REFA', $1::uuid)", [partnerId]);
  await db.query("insert into promo_codes (code, partner_id) values ('REFB', $1::uuid)", [partnerId]);
  const member = await addUser(db, { firstName: 'Membre' });

  await db.query(
    "insert into referrals (profile_id, code, partner_id, source) values ($1::uuid, 'REFA', $2::uuid, 'link')",
    [member, partnerId],
  );
  // Deuxième tentative sur le même membre → rejetée (PK profile_id).
  await assert.rejects(
    () => db.query(
      "insert into referrals (profile_id, code, partner_id, source) values ($1::uuid, 'REFB', $2::uuid, 'manual')",
      [member, partnerId],
    ),
    'un membre déjà attribué ne peut pas être ré-attribué',
  );
});

test('commission_ledger : event_id UNIQUE → idempotence du rejeu webhook', async () => {
  const partnerId = await addPartner(db, { email: 'p-led@example.com' });
  const member = await addUser(db, { firstName: 'Abonné' });
  const insert = (eventId) => db.query(
    `insert into commission_ledger
       (partner_id, profile_id, event_id, event_type, gross_cents, net_cents, rate_bps, commission_cents, hold_until)
     values ($1::uuid, $2::uuid, $3, 'RENEWAL', 1199, 1019, 3000, 305, now() + interval '30 days')`,
    [partnerId, member, eventId],
  );
  await insert('evt_123');
  await assert.rejects(() => insert('evt_123'), 'le même event_id RC ne doit pas créer deux commissions');
  await insert('evt_456'); // un autre événement passe
});

test('commission_ledger : statut borné (pending/validated/paid/reversed)', async () => {
  const partnerId = await addPartner(db, { email: 'p-status2@example.com' });
  const member = await addUser(db, { firstName: 'Payeur' });
  const { rows } = await db.query(
    `insert into commission_ledger
       (partner_id, profile_id, event_id, event_type, gross_cents, net_cents, rate_bps, commission_cents, hold_until)
     values ($1::uuid, $2::uuid, 'evt_s', 'INITIAL_PURCHASE', 1199, 1019, 4000, 407, now())
     returning id, status`,
    [partnerId, member],
  );
  assert.equal(rows[0].status, 'pending');
  for (const s of ['validated', 'paid', 'reversed']) {
    await db.query('update commission_ledger set status = $1 where id = $2::uuid', [s, rows[0].id]);
  }
  await assert.rejects(
    () => db.query("update commission_ledger set status = 'zzz' where id = $1::uuid", [rows[0].id]),
    'un statut inconnu doit être rejeté',
  );
});

test('RLS : les tables partenaires sont invisibles au client (authenticated)', async () => {
  const partnerId = await addPartner(db, { email: 'p-rls@example.com' });
  const member = await addUser(db, { firstName: 'Curieuse' });
  await db.query("insert into promo_codes (code, partner_id) values ('RLSX', $1::uuid)", [partnerId]);

  await asUser(db, member, async () => {
    for (const tbl of ['partners', 'promo_codes', 'referrals', 'partner_payouts', 'commission_ledger']) {
      const { rows } = await db.query(`select 1 from ${tbl}`);
      assert.equal(rows.length, 0, `${tbl} doit être fermée au client (RLS sans policy)`);
    }
  });
});
