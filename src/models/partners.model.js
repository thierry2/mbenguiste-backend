'use strict';
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Partenaires (influenceurs) & leurs codes. Lecture/écriture backend only
// (service_role) : le portail passe par l'API, jamais par Supabase en direct.
// ─────────────────────────────────────────────────────────────────────────────

function toPartner(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    rateBps: row.rate_bps,
    isFounder: row.is_founder,
    status: row.status,
  };
}

/** → partenaire par id, ou null. */
async function findById(id) {
  const { data } = await supabase
    .from('partners')
    .select('id, display_name, email, rate_bps, is_founder, status')
    .eq('id', id)
    .maybeSingle();
  return toPartner(data);
}

/** → partenaire lié à son compte Supabase (portail), ou null. */
async function findByAuthUser(authUserId) {
  const { data } = await supabase
    .from('partners')
    .select('id, display_name, email, rate_bps, is_founder, status')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  return toPartner(data);
}

/**
 * Résout un code ACTIF en partenaire { partnerId, rateBps, status, isFounder }.
 * null si le code est inconnu, inactif, ou le partenaire absent.
 */
async function findByPromoCode(code) {
  const { data } = await supabase
    .from('promo_codes')
    .select('is_active, partners:partner_id (id, rate_bps, status, is_founder)')
    .eq('code', code)
    .maybeSingle();
  if (!data || !data.is_active || !data.partners) return null;
  const p = data.partners;
  return { partnerId: p.id, rateBps: p.rate_bps, status: p.status, isFounder: p.is_founder };
}

module.exports = { findById, findByAuthUser, findByPromoCode };
