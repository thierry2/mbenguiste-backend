const supabase = require('../config/supabase');

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

/** Dossier OUVERT existant du même signaleur sur la même cible (idempotence). */
async function findOpenReport(reporterId, reportedId) {
  const { data, error } = await supabase
    .from('reports')
    .select('id')
    .eq('reporter_id', reporterId)
    .eq('reported_id', reportedId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Insère un signalement. Le doublon (course avec l'index unique) est un succès. */
async function createReport({ reporterId, reportedId, reasonId, details }) {
  const { error } = await supabase.from('reports').insert({
    reporter_id: reporterId,
    reported_id: reportedId,
    reason_id: reasonId,
    details: details?.slice(0, 1000) || null,
  });
  // 23505 = violation de l'index unique « un dossier ouvert par paire » : un
  // double tap ou une course — le signalement existe déjà, ce n'est pas un échec.
  if (error && error.code !== '23505') throw error;
}

/** Nombre de signaleurs DISTINCTS ayant un dossier ouvert sur cette cible. */
async function countOpenReporters(reportedId) {
  const { data, error } = await supabase
    .from('reports')
    .select('reporter_id')
    .eq('reported_id', reportedId)
    .eq('status', 'open');
  if (error) throw error;
  return new Set((data || []).map((r) => r.reporter_id)).size;
}

/** Retire un profil de la découverte (protection auto en attendant revue). */
async function hideFromDiscovery(profileId) {
  const { error } = await supabase
    .from('profiles')
    .update({ is_discoverable: false, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw error;
}

module.exports = { block, unblock, listBlocked, findOpenReport, createReport, countOpenReporters, hideFromDiscovery };
