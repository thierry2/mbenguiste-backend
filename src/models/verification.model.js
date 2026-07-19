const supabase = require('../config/supabase');

/**
 * Accès table `verification_requests` (migration 030). Aucune décision ici :
 * les règles (fenêtre de capture, cooldown, tirage de pose) vivent dans
 * src/domain/verification.js, testé à sec.
 */

const ACTIVE = ['awaiting_selfie', 'pending_review'];

/** La requête ACTIVE de la personne (capture en cours ou revue en attente), ou null. */
async function activeFor(userId) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('user_id', userId)
    .in('status', ACTIVE)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** La dernière requête tout statut confondu (pour afficher « refusée » / « vérifiée »). */
async function lastFor(userId) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Historique des rejets : combien, et quand le dernier (→ cooldown). */
async function rejectionHistory(userId) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select('reviewed_at')
    .eq('user_id', userId)
    .eq('status', 'rejected')
    .order('reviewed_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  return { attempts: rows.length, lastRejectedAt: rows[0]?.reviewed_at ?? null };
}

/** Crée une requête en attente de selfie, avec la pose tirée et la fin de fenêtre. */
async function create({ userId, poseCode, captureExpiresAt, attemptNo }) {
  const { data, error } = await supabase
    .from('verification_requests')
    .insert({
      user_id: userId,
      pose_code: poseCode,
      capture_expires_at: captureExpiresAt,
      attempt_no: attemptNo,
      status: 'awaiting_selfie',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Attache le selfie et passe la requête en revue.
 * Le `.eq('status', 'awaiting_selfie')` est la garde de concurrence : deux envois
 * simultanés, un seul gagne — le second ne trouve plus la ligne.
 */
async function attachSelfie(id, selfiePath) {
  const { data, error } = await supabase
    .from('verification_requests')
    .update({
      selfie_path: selfiePath,
      status: 'pending_review',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'awaiting_selfie')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Passe en `expired` les captures jamais envoyées dont la fenêtre est écoulée. */
async function expireStaleCaptures(now = new Date()) {
  const { data, error } = await supabase
    .from('verification_requests')
    .update({ status: 'expired' })
    .eq('status', 'awaiting_selfie')
    .lt('capture_expires_at', new Date(now).toISOString())
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

/** File d'attente admin : les selfies en attente de revue, du plus ancien au plus récent. */
async function reviewQueue(limit = 100) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Combien de selfies attendent une décision (bandeau de la console). */
async function pendingCount() {
  const { count, error } = await supabase
    .from('verification_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  if (error) throw error;
  return count ?? 0;
}

async function byId(id) {
  const { data, error } = await supabase
    .from('verification_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Enregistre la décision humaine. Garde `.eq('status', 'pending_review')` :
 * deux admins qui cliquent en même temps → une seule décision passe.
 */
async function decide(id, { status, reviewedBy, reason = null }) {
  const { data, error } = await supabase
    .from('verification_requests')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
      rejection_reason: reason,
      // Le selfie est effacé du bucket après décision → le chemin ne pointe plus rien.
      selfie_path: null,
    })
    .eq('id', id)
    .eq('status', 'pending_review')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Accorde (ou retire) le sceau. `verified_at` sert d'audit. */
async function setVerified(userId, verified) {
  const { error } = await supabase
    .from('profiles')
    .update({
      is_verified: verified,
      verified_at: verified ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw error;
}

/** Profil minimal affiché à côté du selfie dans la console (photos à comparer). */
async function reviewSubject(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, avatar_url, is_verified')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { data: photos, error: e2 } = await supabase
    .from('profile_photos')
    .select('url, position')
    .eq('profile_id', userId)
    .order('position', { ascending: true })
    .limit(6);
  if (e2) throw e2;

  return {
    id: data.id,
    prenom: data.first_name,
    avatarUrl: data.avatar_url ?? null,
    dejaVerifiee: data.is_verified === true,
    photos: (photos || []).map((p) => p.url),
  };
}

module.exports = {
  activeFor, lastFor, rejectionHistory, create, attachSelfie,
  expireStaleCaptures, reviewQueue, pendingCount, byId, decide,
  setVerified, reviewSubject,
};
