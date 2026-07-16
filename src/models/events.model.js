const supabase = require('../config/supabase');

/**
 * Télémétrie deck — écriture par RPC atomique (migration 018) et lectures
 * d'agrégats pour le ranking. Les événements BRUTS (deck_events) ne sont
 * jamais lus ici : ils sont le réservoir de la personnalisation V2.
 */

/**
 * Ingestion d'un batch nettoyé par le service. Le RPC est idempotent par
 * (viewer, clientRef) et maintient les agrégats dans la même transaction.
 * Renvoie le nombre d'événements NOUVEAUX.
 */
async function ingest(viewerId, events) {
  const { data, error } = await supabase.rpc('ingest_deck_events', {
    p_viewer: viewerId,
    p_events: events.map((e) => ({
      targetId: e.targetId,
      kind: e.kind,
      dwellMs: e.dwellMs ?? null,
      payload: e.payload ?? {},
      clientRef: e.clientRef,
    })),
  });
  if (error) throw error;
  return data ?? 0;
}

/** Agrégats d'engagement pour une liste de profils — Map id→ligne (absent = jamais vu). */
async function engagementByIds(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('profile_engagement')
    .select('profile_id, impressions, dwell_ms_total, profile_opens, likes_received, passes_received')
    .in('profile_id', ids);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.profile_id, {
    impressions: r.impressions,
    dwellMsTotal: Number(r.dwell_ms_total),
    profileOpens: r.profile_opens,
    likesReceived: r.likes_received,
    passesReceived: r.passes_received,
  }]));
}

/** Rotation : combien de fois J'AI déjà vu chacun — Map targetId→{seenCount, lastSeenAt}. */
async function impressionsFor(viewerId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('deck_impressions')
    .select('target_id, seen_count, last_seen_at')
    .eq('viewer_id', viewerId)
    .in('target_id', ids);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.target_id, {
    seenCount: r.seen_count,
    lastSeenAt: r.last_seen_at,
  }]));
}

module.exports = { ingest, engagementByIds, impressionsFor };
