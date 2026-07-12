const supabase = require('../config/supabase');

/** Soldes de consommables de l'utilisateur (Coups de cœur, Boosts). */
async function get(profileId) {
  const { data } = await supabase
    .from('user_credits')
    .select('superlike_balance, boost_balance')
    .eq('profile_id', profileId)
    .maybeSingle();
  return {
    superLikes: data?.superlike_balance ?? 0,
    boosts:     data?.boost_balance ?? 0,
  };
}

/** Crédite (achat). Lecture-puis-écriture — écritures backend only, pas de course client. */
async function grant(profileId, { superLikes = 0, boosts = 0 }) {
  const cur = await get(profileId);
  const { error } = await supabase
    .from('user_credits')
    .upsert(
      {
        profile_id: profileId,
        superlike_balance: cur.superLikes + superLikes,
        boost_balance: cur.boosts + boosts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
  if (error) throw error;
  return get(profileId);
}

/** Dépense 1 Coup de cœur si le solde le permet. true si débité, false si vide. */
async function spendSuperLike(profileId) {
  const cur = await get(profileId);
  if (cur.superLikes <= 0) return false;
  const { error } = await supabase
    .from('user_credits')
    .update({ superlike_balance: cur.superLikes - 1, updated_at: new Date().toISOString() })
    .eq('profile_id', profileId);
  if (error) throw error;
  return true;
}

/** Dépense 1 Boost et l'active pour `durationMs`. Renvoie l'échéance ISO, ou null si aucun. */
async function spendBoost(profileId, durationMs) {
  const cur = await get(profileId);
  if (cur.boosts <= 0) return null;
  const until = new Date(Date.now() + durationMs).toISOString();
  const { error } = await supabase
    .from('user_credits')
    .update({ boost_balance: cur.boosts - 1, updated_at: new Date().toISOString() })
    .eq('profile_id', profileId);
  if (error) throw error;
  await supabase.from('profiles').update({ boost_active_until: until }).eq('id', profileId);
  return until;
}

module.exports = { get, grant, spendSuperLike, spendBoost };
