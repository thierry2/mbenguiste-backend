const supabase = require('../config/supabase');
const { REPORT_DETAILS_MAX } = require('../constants/safety');

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

  // Coupe la conversation : le match (peu importe l'ordre canonique) passe
  // inactif, DATÉ (ended_at) — l'écran « Anciennes connexions » s'en sert.
  await supabase
    .from('matches')
    .update({ is_active: false, ended_at: new Date().toISOString() })
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
    // Filet de sécurité seulement : zod a déjà refusé au-delà. La borne vient de
    // la constante partagée pour qu'elle ne puisse plus diverger de la validation.
    details: details?.slice(0, REPORT_DETAILS_MAX) || null,
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

/**
 * Lignes brutes pour « Signaler quelqu'un » : TOUS les matchs (actifs ET
 * défaits — le soft delete les garde) + mes blocages + les profils légers des
 * autres membres. Le façonnage (sections, tri, dédup) est dans
 * safety.service.buildPastConnections, pur et testé à sec.
 */
async function listConnectionsRaw(userId) {
  const [matchesRes, blocksRes] = await Promise.all([
    supabase
      .from('matches')
      .select('id, user_low, user_high, created_at, ended_at, is_active')
      .or(`user_low.eq.${userId},user_high.eq.${userId}`),
    supabase
      .from('blocks')
      .select('blocked_id, created_at')
      .eq('blocker_id', userId),
  ]);
  // Erreurs LEVÉES, jamais avalées (leçon accessRow) : un échec silencieux ici
  // rendrait l'écran vide en cachant la vraie panne.
  if (matchesRes.error) throw matchesRes.error;
  if (blocksRes.error) throw blocksRes.error;
  const matchRows = matchesRes.data || [];
  const blockRows = blocksRes.data || [];

  const otherIds = new Set(blockRows.map((b) => b.blocked_id));
  for (const m of matchRows) otherIds.add(m.user_low === userId ? m.user_high : m.user_low);

  let profilesById = new Map();
  if (otherIds.size) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, avatar_url')
      .in('id', [...otherIds]);
    if (error) throw error;
    profilesById = new Map((data || []).map((p) => [p.id, {
      id: p.id, prenom: p.first_name, avatarUrl: p.avatar_url ?? null,
    }]));
  }

  return { matchRows, blockRows, profilesById };
}

/** Dossier libre (« son profil n'apparaît pas ici ») — la contrainte de longueur
 *  (20–2000) est portée par la table, la validation zod filtre avant. */
async function createFreeformReport(reporterId, body) {
  const { error } = await supabase
    .from('freeform_reports')
    .insert({ reporter_id: reporterId, body });
  if (error) throw error;
}

/** Blocages entre deux membres, dans les DEUX sens (garde de consultation). */
async function blocksBetween(userA, userB) {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`);
  if (error) throw error;
  return data || [];
}

/** Retire un profil de la découverte (protection auto en attendant revue). */
async function hideFromDiscovery(profileId) {
  const { error } = await supabase
    .from('profiles')
    .update({ is_discoverable: false, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw error;
}

module.exports = {
  block, unblock, listBlocked, findOpenReport, createReport, countOpenReporters,
  hideFromDiscovery, listConnectionsRaw, createFreeformReport, blocksBetween,
};
