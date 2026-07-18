'use strict';
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Attribution d'un membre à un code partenaire (une seule par membre — profile_id
// EN PK côté base : le 1er code gagne, jamais réécrit). Écritures backend only.
// ─────────────────────────────────────────────────────────────────────────────

/** → { partnerId, code } de l'attribution du membre, ou null s'il n'est pas référé. */
async function findByProfile(profileId) {
  const { data } = await supabase
    .from('referrals')
    .select('partner_id, code')
    .eq('profile_id', profileId)
    .maybeSingle();
  return data ? { partnerId: data.partner_id, code: data.code } : null;
}

/**
 * Attache un membre à un code. Le 1er code gagne : une attribution existante
 * n'est jamais écrasée (ignoreDuplicates sur la PK profile_id). Renvoie true si
 * cette attribution a été posée, false si le membre était déjà attribué.
 */
async function attach({ profileId, code, partnerId, source = 'manual' }) {
  const existing = await findByProfile(profileId);
  if (existing) return false;
  const { error } = await supabase
    .from('referrals')
    .upsert(
      { profile_id: profileId, code, partner_id: partnerId, source },
      { onConflict: 'profile_id', ignoreDuplicates: true },
    );
  if (error) throw error;
  return true;
}

module.exports = { findByProfile, attach };
