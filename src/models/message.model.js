const supabase = require('../config/supabase');
const { signChatUrl, signChatUrls } = require('../services/upload.service');

const COLS = 'id, match_id, sender_id, body, original_body, source_language, is_translated, media_path, media_type, created_at, read_at';

function fromRow(row, userId, mediaUrl) {
  return {
    id:          row.id,
    matchId:     row.match_id,
    deMoi:       row.sender_id === userId,
    texte:       row.body ?? null,
    original:    row.original_body ?? null,
    langueSource: row.source_language ?? null,
    traduit:     row.is_translated ?? false,
    // Image de message : URL signée temporaire (le chemin privé n'est jamais exposé).
    mediaUrl:    mediaUrl ?? null,
    mediaType:   row.media_type ?? null,
    envoyeLe:    row.created_at,
    luLe:        row.read_at ?? null,
  };
}

/** Fil d'un match, du plus récent au plus ancien. Signe les médias en un seul appel. */
async function list(matchId, userId, { before, limit = 30 } = {}) {
  let query = supabase
    .from('messages')
    .select(COLS)
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw error;

  const urls = await signChatUrls((data || []).map((r) => r.media_path));
  return (data || []).map((r) => fromRow(r, userId, urls.get(r.media_path)));
}

async function send(matchId, senderId, { body, originalBody, sourceLanguage, isTranslated, mediaPath, mediaType }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      match_id: matchId,
      sender_id: senderId,
      body: body ?? null,
      original_body: originalBody ?? null,
      source_language: sourceLanguage ?? null,
      is_translated: !!isTranslated,
      media_path: mediaPath ?? null,
      media_type: mediaType ?? null,
    })
    .select(COLS)
    .single();
  if (error) throw error;

  const mediaUrl = data.media_path ? await signChatUrl(data.media_path) : null;
  return fromRow(data, senderId, mediaUrl);
}

/** Signe le média d'un message précis (utilisé par le front après un INSERT Realtime). */
async function signOne(matchId, messageId) {
  const { data } = await supabase
    .from('messages')
    .select('media_path')
    .eq('id', messageId)
    .eq('match_id', matchId)
    .maybeSingle();
  return data?.media_path ? signChatUrl(data.media_path) : null;
}

async function markRead(matchId, userId) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .neq('sender_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

async function unreadCount(userId) {
  const { data: matches } = await supabase
    .from('matches')
    .select('id')
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .eq('is_active', true);
  const ids = (matches || []).map((m) => m.id);
  if (!ids.length) return 0;

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('match_id', ids)
    .neq('sender_id', userId)
    .is('read_at', null);
  return count ?? 0;
}

module.exports = { list, send, signOne, markRead, unreadCount };
