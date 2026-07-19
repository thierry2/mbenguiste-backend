'use strict';
const supabase = require('../config/supabase');
const config = require('../config');
const logger = require('../utils/logger');
const partnersModel = require('../models/partners.model');

/**
 * Où le lien d'invitation doit ramener. Décidé par le SERVEUR (PUBLIC_BASE_URL),
 * jamais par le navigateur : sinon inviter depuis une console ouverte en local
 * fabrique un lien vers localhost, que le partenaire ne pourra pas ouvrir.
 * Vide → on n'envoie pas de redirectTo et Supabase applique son « Site URL ».
 */
function redirectUrl() {
  return config.publicBaseUrl ? config.publicBaseUrl + '/partenaires' : undefined;
}

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
      // L'email n'est pas parti, mais le compte Supabase peut TRÈS BIEN exister
      // (créé par une tentative précédente, ou déjà membre). Sans cette
      // récupération, la fiche partenaire reste orpheline et son propriétaire se
      // voit refuser l'entrée même après s'être connecté.
      return {
        invited: false,
        authUserId: await lookupAuthUserId(email),
        error: error.message || String(error),
      };
    }
    return { invited: true, authUserId: data?.user?.id || null, error: null };
  } catch (e) {
    logger.error(`Invitation partenaire ${email} en échec : ${e.message || e}`);
    return { invited: false, authUserId: await lookupAuthUserId(email), error: e.message || String(e) };
  }
}

/** Retrouve l'id du compte Supabase d'un email, s'il existe déjà. null sinon. */
async function lookupAuthUserId(email) {
  try {
    const cible = String(email || '').trim().toLowerCase();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error || !data || !data.users) return null;
    const trouve = data.users.find((u) => String(u.email || '').toLowerCase() === cible);
    return trouve ? trouve.id : null;
  } catch {
    return null;
  }
}

/**
 * Crée un partenaire, son code, et l'invite par email (il choisira lien magique
 * ou mot de passe via le lien). Renvoie { partner, invited, inviteError }.
 */
async function createAndInvite({ displayName, email, code, isFounder = false, rateBps }) {
  const rate = rateBps != null ? rateBps : (isFounder ? 4000 : undefined);
  const partner = await partnersModel.create({ displayName, email, isFounder, rateBps: rate });
  const finalCode = await partnersModel.createCode({
    code: code || defaultCode(displayName),
    partnerId: partner.id,
  });

  const { invited, authUserId, error } = await sendInvite(partner.email, redirectUrl());
  if (authUserId) await partnersModel.attachAuthUser(partner.id, authUserId);

  return { partner: { ...partner, code: finalCode }, invited, inviteError: error };
}

/**
 * Relance l'invitation d'un partenaire existant (email non reçu, lien expiré).
 * Renvoie { invited, inviteError }.
 */
async function reinvite(partnerId) {
  const partner = await partnersModel.findById(partnerId);
  if (!partner) return { invited: false, inviteError: 'Partenaire introuvable' };

  const { invited, authUserId, error } = await sendInvite(partner.email, redirectUrl());
  if (authUserId) await partnersModel.attachAuthUser(partner.id, authUserId);

  return { invited, inviteError: error, email: partner.email, redirectTo: redirectUrl() || null };
}

module.exports = { createAndInvite, reinvite, sendInvite, defaultCode };
