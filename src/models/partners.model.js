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

/** → partenaire lié à son compte Supabase (portail) + son code, ou null. */
async function findByAuthUser(authUserId) {
  const { data } = await supabase
    .from('partners')
    .select('id, display_name, email, rate_bps, is_founder, status, promo_codes(code)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!data) return null;
  const partner = toPartner(data);
  partner.code = data.promo_codes?.[0]?.code || null;
  return partner;
}

/**
 * → partenaire par email (+ son code et son éventuel compte déjà lié).
 * Sert au rattachement de secours : un partenaire invité dont le compte Supabase
 * existe mais n'a jamais été relié à sa fiche (invitation dont l'email n'est pas
 * parti : Supabase crée le compte quand même).
 */
async function findByEmail(email) {
  const { data } = await supabase
    .from('partners')
    .select('id, display_name, email, rate_bps, is_founder, status, auth_user_id, promo_codes(code)')
    .eq('email', String(email || '').trim().toLowerCase())
    .maybeSingle();
  if (!data) return null;
  const partner = toPartner(data);
  partner.code = data.promo_codes?.[0]?.code || null;
  partner.authUserId = data.auth_user_id || null;
  return partner;
}

/**
 * Résout un code ACTIF en partenaire { partnerId, rateBps, status, isFounder }.
 * null si le code est inconnu, inactif, ou le partenaire absent.
 */
async function findByPromoCode(code) {
  const { data } = await supabase
    .from('promo_codes')
    .select('is_active, partners:partner_id (id, display_name, rate_bps, status, is_founder)')
    .eq('code', code)
    .maybeSingle();
  if (!data || !data.is_active || !data.partners) return null;
  const p = data.partners;
  return { partnerId: p.id, displayName: p.display_name, rateBps: p.rate_bps, status: p.status, isFounder: p.is_founder };
}

// ── Écritures admin ──────────────────────────────────────────────────────────

/** Crée un partenaire. Renvoie le partenaire créé. */
async function create({ displayName, email, isFounder = false, rateBps }) {
  const row = { display_name: displayName, email: email.trim().toLowerCase(), is_founder: !!isFounder };
  if (rateBps != null) row.rate_bps = rateBps;
  const { data, error } = await supabase
    .from('partners')
    .insert(row)
    .select('id, display_name, email, rate_bps, is_founder, status')
    .single();
  if (error) throw error;
  return toPartner(data);
}

/** Crée (ou réactive) le code d'un partenaire. Le code est normalisé MAJUSCULES. */
async function createCode({ code, partnerId }) {
  const normalized = String(code).trim().toUpperCase();
  const { error } = await supabase
    .from('promo_codes')
    .upsert({ code: normalized, partner_id: partnerId, is_active: true }, { onConflict: 'code' });
  if (error) throw error;
  return normalized;
}

/** Lie le compte Supabase (après invitation) + passe le partenaire en actif. */
async function linkAuthUser(partnerId, authUserId) {
  const { error } = await supabase
    .from('partners')
    .update({ auth_user_id: authUserId, status: 'active', activated_at: new Date().toISOString() })
    .eq('id', partnerId);
  if (error) throw error;
}

/** Lie le compte Supabase sans changer le statut (invitation en attente). */
async function attachAuthUser(partnerId, authUserId) {
  const { error } = await supabase
    .from('partners')
    .update({ auth_user_id: authUserId })
    .eq('id', partnerId);
  if (error) throw error;
}

/** Change le statut (invited/active/frozen). */
async function setStatus(partnerId, status) {
  const { error } = await supabase.from('partners').update({ status }).eq('id', partnerId);
  if (error) throw error;
}

/** Liste tous les partenaires + leur code (pour la console admin). */
async function list() {
  const { data } = await supabase
    .from('partners')
    .select('id, display_name, email, rate_bps, is_founder, status, created_at, promo_codes(code)')
    .order('created_at', { ascending: false });
  return (data || []).map((row) => ({
    ...toPartner(row),
    createdAt: row.created_at,
    code: row.promo_codes?.[0]?.code || null,
  }));
}

module.exports = {
  findById, findByAuthUser, findByEmail, findByPromoCode,
  create, createCode, linkAuthUser, attachAuthUser, setStatus, list,
};
