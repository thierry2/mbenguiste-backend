'use strict';
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Registre des commissions. Idempotent par event_id (rejeu webhook sans doublon).
// Montants en centimes entiers. Écritures backend only (service_role).
// ─────────────────────────────────────────────────────────────────────────────

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

/** Date du 1er paiement commissionné de cet abonné (borne des 12 mois), ou null. */
async function firstOccurredAt(profileId) {
  const { data } = await supabase
    .from('commission_ledger')
    .select('occurred_at')
    .eq('profile_id', profileId)
    .neq('status', 'reversed')
    .order('occurred_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? new Date(data.occurred_at) : null;
}

/**
 * Inscrit une commission. event_id UNIQUE → un rejeu du même événement RC
 * n'insère rien (ignoreDuplicates). Statut initial : pending.
 */
async function record(spec) {
  const { error } = await supabase
    .from('commission_ledger')
    .upsert(
      {
        partner_id: spec.partnerId,
        profile_id: spec.profileId,
        event_id: spec.eventId,
        event_type: spec.eventType,
        gross_cents: spec.grossCents,
        net_cents: spec.netCents,
        rate_bps: spec.rateBps,
        commission_cents: spec.commissionCents,
        currency: spec.currency,
        occurred_at: iso(spec.occurredAt),
        hold_until: iso(spec.holdUntil),
      },
      { onConflict: 'event_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Annule (reversed) la commission d'un événement remboursé, si encore due. */
async function reverseByEventId(eventId) {
  const { error } = await supabase
    .from('commission_ledger')
    .update({ status: 'reversed' })
    .eq('event_id', eventId)
    .in('status', ['pending', 'validated']);
  if (error) throw error;
}

module.exports = { firstOccurredAt, record, reverseByEventId };
