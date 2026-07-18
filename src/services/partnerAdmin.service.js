'use strict';
const supabase = require('../config/supabase');
const partnersModel = require('../models/partners.model');

// ─────────────────────────────────────────────────────────────────────────────
// Gestion des partenaires côté console admin (secret partagé). Création + code +
// invitation Supabase (best-effort : l'invitation échoue sans casser la création).
// ─────────────────────────────────────────────────────────────────────────────

/** Code par défaut : 1er mot du nom, MAJUSCULES, alphanumérique. */
function defaultCode(displayName) {
  const first = String(displayName || '').trim().split(/\s+/)[0] || 'PARTENAIRE';
  return first.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'PARTENAIRE';
}

/**
 * Crée un partenaire, son code, et l'invite par email (le partenaire choisira
 * lien magique ou mot de passe via le lien). Renvoie { partner, invited }.
 */
async function createAndInvite({ displayName, email, code, isFounder = false, rateBps, redirectTo }) {
  const rate = rateBps != null ? rateBps : (isFounder ? 4000 : undefined);
  const partner = await partnersModel.create({ displayName, email, isFounder, rateBps: rate });
  const finalCode = await partnersModel.createCode({
    code: code || defaultCode(displayName),
    partnerId: partner.id,
  });

  let invited = false;
  try {
    const opts = redirectTo ? { redirectTo } : undefined;
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, opts);
    if (!error && data?.user) {
      await partnersModel.attachAuthUser(partner.id, data.user.id);
      invited = true;
    }
  } catch {
    // Best-effort : partenaire + code créés ; l'invitation pourra être relancée.
  }

  return { partner: { ...partner, code: finalCode }, invited };
}

module.exports = { createAndInvite, defaultCode };
