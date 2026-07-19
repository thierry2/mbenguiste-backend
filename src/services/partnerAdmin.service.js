'use strict';
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const partnersModel = require('../models/partners.model');

// ─────────────────────────────────────────────────────────────────────────────
// Gestion des partenaires côté console admin (secret partagé). Création + code +
// invitation Supabase.
//
// L'invitation est best-effort (elle ne doit pas empêcher la création), MAIS son
// erreur est REMONTÉE et LOGUÉE : une invitation muette est indébogable — c'est
// Supabase qui envoie l'email, donc la cause (SMTP absent, quota, URL de retour
// non autorisée, email déjà inscrit…) ne vit que dans sa réponse.
// ─────────────────────────────────────────────────────────────────────────────

/** Code par défaut : 1er mot du nom, MAJUSCULES, alphanumérique. */
function defaultCode(displayName) {
  const first = String(displayName || '').trim().split(/\s+/)[0] || 'PARTENAIRE';
  return first.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PARTENAIRE';
}

/**
 * Envoie l'invitation Supabase. Ne lève jamais : renvoie toujours
 * { invited, authUserId, error } pour que l'appelant puisse l'afficher.
 */
async function sendInvite(email, redirectTo) {
  try {
    const opts = redirectTo ? { redirectTo } : undefined;
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, opts);
    if (error) {
      logger.error(`Invitation partenaire ${email} refusée par Supabase : ${error.message || error}`);
      return { invited: false, authUserId: null, error: error.message || String(error) };
    }
    return { invited: true, authUserId: data?.user?.id || null, error: null };
  } catch (e) {
    logger.error(`Invitation partenaire ${email} en échec : ${e.message || e}`);
    return { invited: false, authUserId: null, error: e.message || String(e) };
  }
}

/**
 * Crée un partenaire, son code, et l'invite par email (il choisira lien magique
 * ou mot de passe via le lien). Renvoie { partner, invited, inviteError }.
 */
async function createAndInvite({ displayName, email, code, isFounder = false, rateBps, redirectTo }) {
  const rate = rateBps != null ? rateBps : (isFounder ? 4000 : undefined);
  const partner = await partnersModel.create({ displayName, email, isFounder, rateBps: rate });
  const finalCode = await partnersModel.createCode({
    code: code || defaultCode(displayName),
    partnerId: partner.id,
  });

  const { invited, authUserId, error } = await sendInvite(partner.email, redirectTo);
  if (authUserId) await partnersModel.attachAuthUser(partner.id, authUserId);

  return { partner: { ...partner, code: finalCode }, invited, inviteError: error };
}

/**
 * Relance l'invitation d'un partenaire existant (email non reçu, lien expiré).
 * Renvoie { invited, inviteError }.
 */
async function reinvite(partnerId, redirectTo) {
  const partner = await partnersModel.findById(partnerId);
  if (!partner) return { invited: false, inviteError: 'Partenaire introuvable' };

  const { invited, authUserId, error } = await sendInvite(partner.email, redirectTo);
  if (authUserId) await partnersModel.attachAuthUser(partner.id, authUserId);

  return { invited, inviteError: error, email: partner.email };
}

module.exports = { createAndInvite, reinvite, sendInvite, defaultCode };
