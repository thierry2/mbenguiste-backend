const supabase = require('../config/supabase');
const referenceModel = require('./reference.model');

/**
 * Bloque `blockedId` pour `blockerId` : insère le blocage (idempotent) ET désactive
 * un éventuel match entre les deux (comme Tinder : bloquer = ne plus jamais se voir
 * ni se parler). La découverte exclut déjà les blocages dans les deux sens
 * (discovery.model). Le blocage est unidirectionnel en table mais masque des deux côtés.
 */
async function block(blockerId, blockedId) {
  if (blockerId === blockedId) return;
  await supabase
    .from('blocks')
    .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });

  // Coupe la conversation : le match (peu importe l'ordre canonique) passe inactif.
  await supabase
    .from('matches')
    .update({ is_active: false })
    .or(`and(user_low.eq.${blockerId},user_high.eq.${blockedId}),and(user_low.eq.${blockedId},user_high.eq.${blockerId})`);
}

async function unblock(blockerId, blockedId) {
  await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
}

/** Profils que j'ai bloqués (pour l'écran « Contacts bloqués »). */
async function listBlocked(blockerId) {
  const { data, error } = await supabase
    .from('blocks')
    .select('created_at, blocked:profiles!blocked_id(id, first_name, avatar_url)')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.blocked?.id,
    prenom: r.blocked?.first_name,
    avatarUrl: r.blocked?.avatar_url ?? null,
    bloqueLe: r.created_at,
  }));
}

/** Signale un profil. `reasonCode` doit correspondre à report_reasons.code. */
async function report(reporterId, reportedId, reasonCode, details) {
  const reasonId = reasonCode ? await referenceModel.idForCode('report_reasons', reasonCode) : null;
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: reportedId,
    reason_id: reasonId,
    details: details?.slice(0, 1000) || null,
  });
  if (error) throw error;
}

module.exports = { block, unblock, listBlocked, report };
