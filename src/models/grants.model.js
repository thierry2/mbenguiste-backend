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
 */
async function claim(profileId, kind, periodKey) {
  const { error } = await supabase
    .from('recurring_grants')
    .insert({ profile_id: profileId, kind, period_key: periodKey });
  if (!error) return true;
  if (error.code === '23505') return false; // conflit d'unicité = déjà réclamé
  throw error;
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
