const supabase = require('../config/supabase');

// Profil « léger » de l'autre membre du match (pour la liste + l'en-tête de chat).
// `primary_language` sert à traduire vers SA langue : la cible est déduite ICI,
// serveur, jamais reçue du client (il n'a pas à en décider, et il pourrait mentir).
const OTHER_SELECT = `
  id, first_name, birth_date, avatar_url,
  current_city, current_country, target_city, target_country,
  primary_language, is_verified, last_active_at
`.trim();

function otherFromRow(row) {
  if (!row) return null;
  return {
    id:            row.id,
    prenom:        row.first_name,
    avatarUrl:     row.avatar_url ?? null,
    villeActuelle: row.current_city ?? null,
    paysActuel:    row.current_country ?? null,
    villeCible:    row.target_city ?? null,
    paysCible:     row.target_country ?? null,
    languePrincipale: row.primary_language ?? null,
    estVerifie:    row.is_verified ?? false,
    lastActiveAt:  row.last_active_at,
  };
}

/** Liste des matchs de l'utilisateur, triés par dernière activité. */
async function listForUser(userId) {
  const { data: rows, error } = await supabase
    .from('matches')
    .select('id, user_low, user_high, created_at, last_message_at, is_active')
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .eq('is_active', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!rows?.length) return [];

  const otherIds = rows.map((m) => (m.user_low === userId ? m.user_high : m.user_low));

  // Erreurs LEVÉES, jamais avalées : un select qui échoue ici rendrait tous les
  // profils null (liste de fantômes) sans le moindre bruit.
  const [profilesRes, lastMsgsRes] = await Promise.all([
    supabase.from('profiles').select(OTHER_SELECT).in('id', otherIds),
    // Dernier message par match (on récupère large puis on réduit côté JS).
    supabase.from('messages')
      .select('match_id, body, sender_id, created_at, read_at')
      .in('match_id', rows.map((m) => m.id))
      .order('created_at', { ascending: false }),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (lastMsgsRes.error) throw lastMsgsRes.error;
  const { data: profiles } = profilesRes;
  const { data: lastMsgs } = lastMsgsRes;

  const profById = new Map((profiles || []).map((p) => [p.id, otherFromRow(p)]));
  const lastByMatch = new Map();
  const unreadByMatch = new Map();
  for (const msg of lastMsgs || []) {
    if (!lastByMatch.has(msg.match_id)) lastByMatch.set(msg.match_id, msg);
    // Non-lus = messages reçus (pas de moi) et non lus.
    if (msg.sender_id !== userId && !msg.read_at) {
      unreadByMatch.set(msg.match_id, (unreadByMatch.get(msg.match_id) || 0) + 1);
    }
  }

  return rows.map((m) => {
    const otherId = m.user_low === userId ? m.user_high : m.user_low;
    const last = lastByMatch.get(m.id);
    return {
      id: m.id,
      autre: profById.get(otherId) ?? null,
      createdAt: m.createdAt ?? m.created_at,
      dernierMessage: last
        ? { texte: last.body, deMoi: last.sender_id === userId, envoyeLe: last.created_at }
        : null,
      nonLus: unreadByMatch.get(m.id) || 0,
      nouveau: !last, // match sans message encore échangé
    };
  });
}

/** Vérifie l'appartenance et renvoie le match + l'autre profil. */
async function getForUser(matchId, userId) {
  const { data: m, error } = await supabase
    .from('matches')
    .select('id, user_low, user_high, created_at, is_active')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  if (!m || (m.user_low !== userId && m.user_high !== userId)) return null;

  const otherId = m.user_low === userId ? m.user_high : m.user_low;
  const { data: other } = await supabase.from('profiles').select(OTHER_SELECT).eq('id', otherId).maybeSingle();
  return { id: m.id, actif: m.is_active, createdAt: m.created_at, autre: otherFromRow(other) };
}

/** Défaire un match (les deux membres ne se reverront plus). */
async function unmatch(matchId, userId) {
  const m = await getForUser(matchId, userId);
  if (!m) return false;
  const { error } = await supabase.from('matches').update({ is_active: false }).eq('id', matchId);
  if (error) throw error;
  return true;
}

module.exports = { listForUser, getForUser, unmatch };
