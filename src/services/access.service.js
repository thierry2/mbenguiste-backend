'use strict';
const defaultConfig = require('../config');
const defaultProfiles = require('../models/profile.model');
const { resolveTier, capabilitiesFor } = require('../domain/access');

/**
 * LE point de décision unique « qui a droit à quoi » — remplace tous les
 * anciens appels à profileModel.isPremium (swipe, traduction, grille Likes,
 * entitlements). Une seule lecture profil → le domaine décide.
 *
 * Factory à dépendances injectées (testable à sec) + instance par défaut
 * câblée sur les vrais modèles, exportée pour l'app.
 */
function createAccessService({ config, profiles }) {
  /**
   * → { tier, offert, caps, premiumUntil, boostActiveUntil }
   * Profil introuvable (supprimé) = free : les gardes échouent fermé.
   */
  async function forUser(userId, now = Date.now()) {
    const row = await profiles.accessRow(userId);

    // Compat pré-migration 016 : is_premium sans premium_tier = l'ancien « Or ».
    const premiumTier = row?.premiumTier ?? (row?.isPremium ? 'or' : null);

    const { tier, offert } = resolveTier({
      premiumTier,
      premiumUntil: row?.premiumUntil ?? null,
      genderCode: row?.genderCode ?? null,
      freeTierWomen: !!config.freeTierWomen,
      now,
    });

    // TODO(diag) TEMPORAIRE — à retirer : voit le genre lu par le backend, le flag
    // tel que CE process le voit, et le palier résolu. Tranche flag vs genre vs logique.
    console.log('[DIAG access]', JSON.stringify({
      userId,
      rowFound: !!row,
      genderCode: row?.genderCode ?? null,
      premiumTier,
      freeTierWomen: !!config.freeTierWomen,
      tier,
      offert,
    }));

    const boostActiveUntil =
      row?.boostActiveUntil && new Date(row.boostActiveUntil).getTime() > now
        ? row.boostActiveUntil
        : null;

    return {
      tier,
      offert,
      caps: capabilitiesFor(tier, offert),
      premiumUntil: tier !== 'free' && !offert ? (row?.premiumUntil ?? null) : null,
      boostActiveUntil,
    };
  }

  return { forUser };
}

const defaultService = createAccessService({ config: defaultConfig, profiles: defaultProfiles });

module.exports = { createAccessService, forUser: defaultService.forUser };
