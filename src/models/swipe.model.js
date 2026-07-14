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

  const row = { swiper_id: swiperId, target_id: targetId, action_id: actionId };
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

  return { match: match ? { id: match.id, createdAt: match.created_at } : null };
}

module.exports = { record };
