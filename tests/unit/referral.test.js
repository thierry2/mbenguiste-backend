'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// referral.service : validation d'un code (puce de confirmation), attribution
// (1er code gagne), cadeau de bienvenue versé UNE fois (7 j Plus + 3 SL + 1 Boost),
// essai Plus qui n'écrase pas un premium déjà actif. Tout à sec.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReferralService } = require('../../src/services/referral.service');

const NOW = new Date('2026-07-18T12:00:00Z');

function fakePartners(byCode = {}) {
  return { async findByPromoCode(code) { return byCode[code] || null; } };
}
function fakeReferrals() {
  return {
    attached: [],
    async attach({ profileId, code, partnerId }) {
      if (this.attached.some((r) => r.profileId === profileId)) return false; // 1er gagne
      this.attached.push({ profileId, code, partnerId });
      return true;
    },
  };
}
function fakeProfiles(premium = false) {
  return {
    premium, statuses: [],
    async accessRow() { return { isPremium: this.premium }; },
    async setPremiumStatus(id, s) { this.statuses.push({ id, ...s }); },
  };
}
function fakeCredits() {
  return { grants: [], async grant(id, amounts) { this.grants.push({ id, ...amounts }); } };
}

const AMINATA = { partnerId: 'pA', displayName: 'Aminata', rateBps: 4000, status: 'active' };

function make({ premium = false } = {}) {
  const partners = fakePartners({ AMINATA });
  const referrals = fakeReferrals();
  const profiles = fakeProfiles(premium);
  const credits = fakeCredits();
  const service = createReferralService({ partners, referrals, profiles, credits, now: () => NOW });
  return { service, partners, referrals, profiles, credits };
}

test('lookup : code valide (insensible à la casse/espaces) → nom du partenaire', async () => {
  const { service } = make();
  assert.deepEqual(await service.lookup('  aminata '), { valid: true, code: 'AMINATA', partnerName: 'Aminata' });
});

test('lookup : code inconnu → invalide', async () => {
  const { service } = make();
  assert.deepEqual(await service.lookup('ZZZ'), { valid: false });
});

test('lookup : partenaire gelé → invalide', async () => {
  const partners = fakePartners({ GELE: { ...AMINATA, status: 'frozen' } });
  const service = createReferralService({ partners, referrals: fakeReferrals(), profiles: fakeProfiles(), credits: fakeCredits(), now: () => NOW });
  assert.deepEqual(await service.lookup('GELE'), { valid: false });
});

test('redeem : 1er rattachement → attribué + cadeau (7 j Plus + 3 SL + 1 Boost)', async () => {
  const { service, referrals, profiles, credits } = make();
  const r = await service.redeem({ profileId: 'm1', code: 'aminata', source: 'link' });
  assert.equal(r.attributed, true);
  assert.equal(r.partnerName, 'Aminata');
  assert.deepEqual(r.gift, { trialTier: 'plus', trialDays: 7, superLikes: 3, boosts: 1, trialApplied: true });

  assert.equal(referrals.attached.length, 1);
  // Essai Plus 7 jours posé.
  assert.equal(profiles.statuses[0].tier, 'plus');
  assert.equal(profiles.statuses[0].premiumUntil, new Date(NOW.getTime() + 7 * 86400000).toISOString());
  // Crédits : 3 Super Likes + 1 Boost.
  assert.deepEqual(credits.grants[0], { id: 'm1', superLikes: 3, boosts: 1 });
});

test('redeem : membre déjà attribué → pas de re-cadeau', async () => {
  const { service, credits, profiles } = make();
  await service.redeem({ profileId: 'm1', code: 'AMINATA' });
  const again = await service.redeem({ profileId: 'm1', code: 'AMINATA' });
  assert.equal(again.attributed, false);
  assert.equal(again.reason, 'already_referred');
  assert.equal(credits.grants.length, 1);   // une seule fois
  assert.equal(profiles.statuses.length, 1);
});

test('redeem : code invalide → non attribué, aucun cadeau', async () => {
  const { service, credits } = make();
  const r = await service.redeem({ profileId: 'm1', code: 'NOPE' });
  assert.equal(r.attributed, false);
  assert.equal(r.reason, 'invalid_code');
  assert.equal(credits.grants.length, 0);
});

test('redeem : membre déjà premium → essai Plus NON appliqué, crédits quand même', async () => {
  const { service, profiles, credits } = make({ premium: true });
  const r = await service.redeem({ profileId: 'm1', code: 'AMINATA' });
  assert.equal(r.attributed, true);
  assert.equal(r.gift.trialApplied, false);
  assert.equal(profiles.statuses.length, 0);          // pas de rétrogradation
  assert.deepEqual(credits.grants[0], { id: 'm1', superLikes: 3, boosts: 1 });
});
