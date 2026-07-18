'use strict';
const supabase = require('../config/supabase');

/**
 * Registre des grants récurrents — l'idempotence anti double-versement.
 * Une ligne (profil × kind × période) = le grant de cette période a été versé.
 * Écritures backend only (service_role) ; le client lit au mieux les siennes.
 */

/**
 * Réserve le grant de la période. true = première réclamation (il faut créditer),
 * false = déjà versé (ou réclamé par une requête concurrente : l'unicité tranche).
 *
 * `ignoreDuplicates` (= ON CONFLICT DO NOTHING) et pas un insert nu : l'ensure
 * tourne à CHAQUE lecture des entitlements, et laisser la contrainte péter
 * inondait les logs Supabase d'erreurs 23505/409 « normales » (bruit repéré le
 * 18/07). Ligne rendue par le select = on vient de la poser (on a gagné la
 * réclamation) ; rien = déjà versé cette période.
 */
async function claim(profileId, kind, periodKey) {
  const { data, error } = await supabase
    .from('recurring_grants')
    .upsert(
      { profile_id: profileId, kind, period_key: periodKey },
      { onConflict: 'profile_id,kind,period_key', ignoreDuplicates: true },
    )
    .select('profile_id');
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** Rend une réservation dont le versement a échoué (le prochain passage retentera). */
async function release(profileId, kind, periodKey) {
  await supabase
    .from('recurring_grants')
    .delete()
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('period_key', periodKey);
}

module.exports = { claim, release };
