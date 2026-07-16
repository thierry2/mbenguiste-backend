const supabase = require('../config/supabase');

// Fenêtres de quota gratuit (ms). Décidées ici, PAS en base : la table
// usage_counters ne stocke que `used` + `window_start` ; c'est la longueur de
// fenêtre qui définit quand on remet le compteur à zéro.
const WINDOWS = {
  like:        12 * 60 * 60 * 1000, // 12 h glissantes
  superlike:   24 * 60 * 60 * 1000, // 1 jour
  translation: 24 * 60 * 60 * 1000, // 1 jour
  picks_like:  24 * 60 * 60 * 1000, // 1 Coup de cœur interagi / jour
};

/** État courant du compteur, fenêtre expirée = remise à zéro implicite. */
async function readState(profileId, kind) {
  const now = Date.now();
  const win = WINDOWS[kind];
  const { data } = await supabase
    .from('usage_counters')
    .select('used, window_start')
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .maybeSingle();

  if (!data) return { used: 0, windowStart: now };
  const started = new Date(data.window_start).getTime();
  if (Number.isNaN(started) || now - started >= win) return { used: 0, windowStart: now };
  return { used: data.used, windowStart: started };
}

/** Lecture seule : combien il reste et quand ça se réinitialise. */
async function remaining(profileId, kind, limit) {
  const s = await readState(profileId, kind);
  return {
    remaining: Math.max(0, limit - s.used),
    resetAt: new Date(s.windowStart + WINDOWS[kind]).toISOString(),
  };
}

/**
 * Tente de consommer 1 unité de quota gratuit.
 * → { allowed, remaining, resetAt }. `allowed=false` = quota épuisé (→ paywall).
 */
async function consume(profileId, kind, limit) {
  const s = await readState(profileId, kind);
  const resetAt = new Date(s.windowStart + WINDOWS[kind]).toISOString();
  if (s.used >= limit) return { allowed: false, remaining: 0, resetAt };

  const used = s.used + 1;
  const { error } = await supabase
    .from('usage_counters')
    .upsert(
      { profile_id: profileId, kind, used, window_start: new Date(s.windowStart).toISOString() },
      { onConflict: 'profile_id,kind' },
    );
  if (error) throw error;
  return { allowed: true, remaining: Math.max(0, limit - used), resetAt };
}

module.exports = { WINDOWS, remaining, consume };
