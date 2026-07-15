'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// billing.service — le webhook RevenueCat reflété chez nous. RC est la SOURCE
// DE VÉRITÉ ; on ne fait que refléter son état : premium_tier/premium_until pour
// l'abo, crédits pour les consommables. Idempotent (rejeu sans effet de bord).
//
// `app_user_id` = notre profile.id (posé côté app via Purchases.logIn).
//
// Factory à dépendances injectées (testable à sec) + instance par défaut câblée
// sur les vrais modèles, exportée pour le contrôleur webhook.
// ─────────────────────────────────────────────────────────────────────────────
const defaultConfig = require('../config');
const defaultProfiles = require('../models/profile.model');
const defaultCredits = require('../models/credits.model');
const defaultPurchases = require('../models/purchases.model');

// Un entitlement RC = un palier de vente. Le rang tranche quand plusieurs sont
// actifs simultanément (upgrade en cours, grappe d'entitlements) : le plus haut gagne.
const TIER_RANK = { plus: 1, or: 2, prestige: 3 };

// Événements RC qui ACTIVENT / prolongent un abonnement.
const ACTIVATING = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED',
]);
// EXPIRATION coupe l'accès ; CANCELLATION (auto-renouvellement coupé) ne fait RIEN
// — l'accès court jusqu'à l'EXPIRATION effective.

function createBillingService({ config, profiles, credits, purchases }) {
  async function handleEvent(event) {
    if (!event || !event.app_user_id) return;
    const userId = event.app_user_id;
    const type = event.type;

    // ── Consommable (Super Like / Boost / Joker) ──
    if (type === 'NON_RENEWING_PURCHASE') {
      await grantConsumable(userId, event);
      return;
    }

    // ── Abonnement ──
    if (type === 'EXPIRATION') {
      await profiles.setPremiumStatus(userId, { isPremium: false, tier: null, premiumUntil: null });
      return;
    }
    if (!ACTIVATING.has(type)) return; // CANCELLATION, TEST, TRANSFER… : no-op silencieux

    const tier = highestTier(event);
    if (!tier) return; // aucun entitlement connu → on n'écrit rien
    const premiumUntil = event.expiration_at_ms
      ? new Date(Number(event.expiration_at_ms)).toISOString()
      : null;
    await profiles.setPremiumStatus(userId, { isPremium: true, tier, premiumUntil });
  }

  /** Le palier le plus haut parmi les entitlements de l'événement. */
  function highestTier(event) {
    const ids = event.entitlement_ids
      || (event.entitlement_id ? [event.entitlement_id] : null);
    // Ancien format sans liste d'entitlements → l'entitlement unique configuré (or).
    if (!ids) return config.revenuecat.entitlementId;
    let best = null;
    for (const id of ids) {
      if (TIER_RANK[id] && (best === null || TIER_RANK[id] > TIER_RANK[best])) best = id;
    }
    return best;
  }

  /** Crédite un achat de consommable, une seule fois (idempotence via registre de transactions). */
  async function grantConsumable(userId, event) {
    const storeProductId = event.product_id;
    if (!storeProductId) return;

    const product = await purchases.findProductByStoreId(storeProductId);
    if (!product) return; // produit hors catalogue → ignoré sans erreur

    const txId = event.transaction_id || event.id || null;
    if (txId && await purchases.wasProcessed(txId)) return; // RC réessaie → sans effet

    await credits.grant(userId, {
      superLikes: product.kind === 'superlike' ? product.quantity : 0,
      boosts:     product.kind === 'boost'     ? product.quantity : 0,
      jokers:     product.kind === 'joker'     ? product.quantity : 0,
    });

    await purchases.record({
      profileId: userId,
      productId: product.id,
      storeTransactionId: txId,
      quantity: product.quantity,
    });
  }

  return { handleEvent };
}

const defaultService = createBillingService({
  config: defaultConfig,
  profiles: defaultProfiles,
  credits: defaultCredits,
  purchases: defaultPurchases,
});

module.exports = { createBillingService, handleEvent: defaultService.handleEvent };
