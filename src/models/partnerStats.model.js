'use strict';
const supabase = require('../config/supabase');
const { payableRows } = require('../domain/partnerStats');

// ─────────────────────────────────────────────────────────────────────────────
// Lectures & agrégats pour le portail partenaire + enregistrement d'un versement
// manuel. Tout en service_role (le portail passe par l'API après auth).
// ─────────────────────────────────────────────────────────────────────────────

const mapRow = (r) => ({
  id: r.id,
  commissionCents: r.commission_cents,
  status: r.status,
  holdUntil: r.hold_until,
  occurredAt: r.occurred_at,
  eventType: r.event_type,
});

/** Toutes les lignes de commission d'un partenaire (mappées pour le domaine). */
async function ledgerRows(partnerId) {
  const { data } = await supabase
    .from('commission_ledger')
    .select('id, commission_cents, status, hold_until, occurred_at, event_type')
    .eq('partner_id', partnerId);
  return (data || []).map(mapRow);
}

/** Nombre de membres attribués (inscriptions via le code). */
async function signupsCount(partnerId) {
  const { count } = await supabase
    .from('referrals')
    .select('profile_id', { count: 'exact', head: true })
    .eq('partner_id', partnerId);
  return count || 0;
}

/** Nombre d'abonnés actifs parmi les membres référés (is_premium). */
async function activeSubscribersCount(partnerId) {
  const { data } = await supabase.from('referrals').select('profile_id').eq('partner_id', partnerId);
  const ids = (data || []).map((r) => r.profile_id);
  if (!ids.length) return 0;
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('id', ids)
    .eq('is_premium', true);
  return count || 0;
}

/** Derniers abonnés référés (identités masquées — ce sont des membres). */
async function recentReferrals(partnerId, limit = 12) {
  const { data } = await supabase
    .from('referrals')
    .select('profile_id, attributed_at, source, profiles:profile_id (first_name, premium_tier, is_premium)')
    .eq('partner_id', partnerId)
    .order('attributed_at', { ascending: false })
    .limit(limit);

  const lignes = data || [];
  const ids = lignes.map((r) => r.profile_id);

  // « Ta part / mois » : la DERNIÈRE commission réellement inscrite pour ce
  // membre — donc ce qu'il rapporte à chaque échéance. Chiffre tiré du registre,
  // jamais une estimation.
  const parMembre = new Map();
  if (ids.length) {
    const { data: comms } = await supabase
      .from('commission_ledger')
      .select('profile_id, commission_cents, occurred_at')
      .eq('partner_id', partnerId)
      .in('profile_id', ids)
      .neq('status', 'reversed')
      .order('occurred_at', { ascending: true });
    for (const c of comms || []) parMembre.set(c.profile_id, c.commission_cents); // le dernier écrase
  }

  return lignes.map((r) => {
    const p = r.profiles || {};
    const initial = (p.first_name || '?').trim().charAt(0).toUpperCase();
    return {
      member: `${initial}•••`,
      attributedAt: r.attributed_at,
      tier: p.premium_tier || null,
      active: !!p.is_premium,
      shareCents: parMembre.get(r.profile_id) ?? null,
    };
  });
}

/** Historique des versements. */
async function payouts(partnerId) {
  const { data } = await supabase
    .from('partner_payouts')
    .select('id, amount_cents, currency, method, reference, paid_at')
    .eq('partner_id', partnerId)
    .order('paid_at', { ascending: false });
  return (data || []).map((p) => ({
    id: p.id, amountCents: p.amount_cents, currency: p.currency,
    method: p.method, reference: p.reference, paidAt: p.paid_at,
  }));
}

/**
 * Enregistre un versement MANUEL : additionne les commissions payables (validées
 * / hold écoulé), crée une ligne de versement, marque ces commissions 'paid'.
 * Renvoie { amountCents, count }. Idempotence naturelle : une fois marquées
 * 'paid', elles ne sont plus payables au prochain appel.
 */
async function recordPayout(partnerId, { method = null, reference = null, currency = 'EUR' } = {}, now = new Date()) {
  const rows = await ledgerRows(partnerId);
  const payable = payableRows(rows, now);
  const amountCents = payable.reduce((s, r) => s + (Number(r.commissionCents) || 0), 0);
  if (!payable.length) return { amountCents: 0, count: 0 };

  const { data: payout, error } = await supabase
    .from('partner_payouts')
    .insert({ partner_id: partnerId, amount_cents: amountCents, currency, method, reference })
    .select('id')
    .single();
  if (error) throw error;

  const ids = payable.map((r) => r.id);
  const { error: upErr } = await supabase
    .from('commission_ledger')
    .update({ status: 'paid', payout_id: payout.id })
    .in('id', ids);
  if (upErr) throw upErr;

  return { amountCents, count: ids.length, payoutId: payout.id };
}

module.exports = {
  ledgerRows, signupsCount, activeSubscribersCount, recentReferrals, payouts, recordPayout,
};
