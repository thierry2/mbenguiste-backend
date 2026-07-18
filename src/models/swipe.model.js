const supabase = require('../config/supabase');
const { idForCode } = require('./reference.model');

/**
 * Enregistre un swipe (pass | like | super_like).
 * Le trigger SQL `handle_swipe` crée le match si le like est réciproque ;
 * on relit ensuite la table matches pour dire au front s'il y a match.
 *
 * `cible` (optionnel, likes seulement) : le détail aimé façon Hinge —
 * { type: 'photo'|'prompt', ref, comment } — conservé comme amorce au match.
 */
async function record(swiperId, targetId, actionCode, cible = null) {
  const actionId = await idForCode('swipe_actions', actionCode);
  if (!actionId) throw new Error(`Action de swipe inconnue : ${actionCode}`);

  // created_at rafraîchi AUSSI au re-swipe (upsert) : « le dernier swipe » du
  // rewind se lit sur created_at — sans ça, re-swiper garderait l'ancienne date
  // et le rewind annulerait le mauvais swipe.
  const row = { swiper_id: swiperId, target_id: targetId, action_id: actionId, created_at: new Date().toISOString() };
  // Un pass n'aime rien : on n'attache jamais de cible.
  if (actionCode !== 'pass' && cible) {
    row.like_target_type = cible.type ?? null;
    row.like_target_ref = cible.ref ?? null;
    row.like_comment = cible.comment ?? null;
  }

  // Upsert : re-swiper le même profil ne casse rien (idempotent).
  const { error } = await supabase
    .from('swipes')
    .upsert(row, { onConflict: 'swiper_id,target_id' });
  if (error) throw error;

  if (actionCode === 'pass') return { match: null };

  // Le like est-il réciproque ? (le trigger a déjà créé le match le cas échéant)
  const [low, high] = swiperId < targetId ? [swiperId, targetId] : [targetId, swiperId];
  const { data: match } = await supabase
    .from('matches')
    .select('id, created_at')
    .eq('user_low', low)
    .eq('user_high', high)
    .maybeSingle();

  // Le payoff du like ciblé : les mots laissés avec les likes deviennent les
  // premiers messages du chat. Best-effort : un échec ici ne casse pas le swipe.
  if (match) {
    try { await seedOpeners(match.id, swiperId, targetId); } catch { /* silencieux */ }
  }

  return { match: match ? { id: match.id, createdAt: match.created_at } : null };
}

/**
 * Amorce de conversation (le payoff Hinge) : au match, chaque mot laissé avec un
 * like ciblé est injecté comme premier message de son auteur, avec le contexte du
 * détail aimé. Idempotent : uniquement si le fil est encore vide (un re-swipe ou
 * une course ne duplique rien).
 */
async function seedOpeners(matchId, a, b) {
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId);
  if (count) return;

  const { data: rows } = await supabase
    .from('swipes')
    .select('swiper_id, like_target_type, like_target_ref, like_comment, created_at')
    .or(`and(swiper_id.eq.${a},target_id.eq.${b}),and(swiper_id.eq.${b},target_id.eq.${a})`)
    .not('like_comment', 'is', null)
    .order('created_at', { ascending: true });
  if (!rows?.length) return;

  // Les prompts aimés référencent un code — on résout la question pour le contexte.
  const codes = rows.filter((r) => r.like_target_type === 'prompt').map((r) => r.like_target_ref);
  let questions = new Map();
  if (codes.length) {
    const { data: ps } = await supabase.from('prompts').select('code, question').in('code', codes);
    questions = new Map((ps || []).map((p) => [p.code, p.question]));
  }

  const openers = rows.map((r) => {
    const q = r.like_target_type === 'prompt' ? questions.get(r.like_target_ref) : null;
    const body = q
      ? `❤ Sur « ${q} » : ${r.like_comment}`
      : r.like_target_type === 'photo'
        ? `❤ Sur ta photo : ${r.like_comment}`
        : `❤ ${r.like_comment}`;
    return { match_id: matchId, sender_id: r.swiper_id, body };
  });

  const { error } = await supabase.from('messages').insert(openers);
  if (error) throw error;
}

/**
 * Efface le DERNIER swipe de l'utilisateur (Rewind, Lot C). Retourne la cible à
 * restaurer ({ targetId, action }) ou null s'il n'y avait rien. Pour rester
 * cohérent, on efface aussi le match que ce swipe aurait formé — un re-swipe le
 * recréera via le trigger. Best-effort sur le match : ne bloque pas le rewind.
 */
async function deleteLast(swiperId) {
  // ⚠ `swipes` n'a PAS de colonne `id` (PK composite swiper_id+target_id).
  // L'ancien select('id, …') échouait à CHAQUE appel et l'erreur était avalée
  // (catch muet) → « Aucun swipe à annuler » systématique. On sélectionne par
  // la vraie clé et on LÈVE toute erreur.
  const { data: last, error: selError } = await supabase
    .from('swipes')
    .select('target_id, created_at, action:swipe_actions!action_id(code)')
    .eq('swiper_id', swiperId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selError) throw selError;
  if (!last) return null;

  const { error } = await supabase.from('swipes')
    .delete()
    .eq('swiper_id', swiperId)
    .eq('target_id', last.target_id);
  if (error) throw error;

  // Un match éventuellement formé par ce like devient incohérent → on le retire.
  const targetId = last.target_id;
  const [low, high] = swiperId < targetId ? [swiperId, targetId] : [targetId, swiperId];
  try {
    await supabase.from('matches').delete().eq('user_low', low).eq('user_high', high);
  } catch { /* silencieux : le rewind du swipe prime */ }

  return { targetId, action: last.action?.code ?? null };
}

module.exports = { record, deleteLast };
