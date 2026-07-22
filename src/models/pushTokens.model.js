'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LES TOKENS PUSH D'UN COMPTE — un par appareil (migration 037).
//
// Avant, `profiles.push_token` n'en gardait qu'UN : se connecter sur un second
// téléphone rendait le premier muet, sans le dire. Diagnostiquer ça coûte cher,
// parce que le symptôme (« je ne reçois plus rien ») ressemble à une panne de
// configuration FCM alors que tout va bien — le token appartient juste à un
// autre appareil.
//
// LA CLÉ EST LE TOKEN. Un même appareil peut changer de compte : le token doit
// alors suivre le NOUVEAU compte, sinon l'ancien propriétaire recevrait les
// notifications destinées à quelqu'un d'autre — une fuite, pas juste un bug.
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../config/supabase');

/** Enregistre (ou réattribue) un token. Idempotent. */
async function save(profileId, token, platform = null) {
  if (!profileId || !token) return;
  const { error } = await supabase.from('push_tokens').upsert(
    { token, profile_id: profileId, platform, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
  if (error) throw error;
}

/**
 * Tous les tokens LIVRABLES d'un compte.
 *
 * Repli sur `profiles.push_token` tant que la table peut être vide pour ce
 * compte (migration tout juste passée, ou backend déployé avant elle) : sans ce
 * filet, le déploiement couperait les notifications de tout le monde jusqu'à la
 * prochaine ouverture de l'app.
 */
async function listFor(profileId) {
  if (!profileId) return [];
  const { data } = await supabase
    .from('push_tokens').select('token').eq('profile_id', profileId);
  const tokens = (data || []).map((r) => r.token).filter(estLivrable);
  if (tokens.length) return tokens;

  const { data: p } = await supabase
    .from('profiles').select('push_token').eq('id', profileId).maybeSingle();
  return estLivrable(p?.push_token) ? [p.push_token] : [];
}

/** Supprime un token mort (DeviceNotRegistered remonté par Expo). */
async function remove(token) {
  if (!token) return;
  await supabase.from('push_tokens').delete().eq('token', token);
  // La colonne héritée est nettoyée en parallèle tant qu'elle existe, sinon un
  // token mort y survivrait et le repli de `listFor` le ressusciterait.
  await supabase.from('profiles').update({ push_token: null }).eq('push_token', token);
}

/**
 * Un token que l'API Expo peut livrer. Le vérifier ICI évite de découvrir des
 * heures plus tard, dans un reçu, qu'on envoyait dans le vide.
 */
function estLivrable(token) {
  return typeof token === 'string' && token.startsWith('ExponentPushToken');
}

module.exports = { save, listFor, remove, estLivrable };
