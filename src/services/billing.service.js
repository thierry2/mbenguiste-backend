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
const defaultReferrals = require('../models/referrals.model');
const defaultPartners = require('../models/partners.model');
const defaultCommissions = require('../models/commissions.model');
const { computeCommission, isRefund } = require('../domain/commission');

// Un entitlement RC = un palier de vente. Le rang tranche quand plusieurs sont
// actifs simultanément (upgrade en cours, grappe d'entitlements) : le plus haut gagne.
const TIER_RANK = { plus: 1, or: 2, prestige: 3 };

// Événements RC qui ACTIVENT / prolongent un abonnement.
const ACTIVATING = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED',
]);
// EXPIRATION coupe l'accès ; CANCELLATION (auto-renouvellement coupé) ne fait RIEN
// — l'accès court jusqu'à l'EXPIRATION effective.

function createBillingService({
  config, profiles, credits, purchases,
  referrals, partners, commissions, now,
}) {
  const clock = now || (() => new Date());

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
      await handleCommission(userId, event); // une EXPIRATION peut être un remboursement
      return;
    }
    if (!ACTIVATING.has(type)) {
      // CANCELLATION, TEST, TRANSFER… : no-op abo — mais un CANCELLATION peut
      // porter un remboursement, d'où la tentative de réversion.
      await handleCommission(userId, event);
      return;
    }

    const tier = highestTier(event);
    if (tier) {
      const premiumUntil = event.expiration_at_ms
        ? new Date(Number(event.expiration_at_ms)).toISOString()
        : null;
      await profiles.setPremiumStatus(userId, { isPremium: true, tier, premiumUntil });
    }
    await handleCommission(userId, event);
  }

  /**
   * Commission partenaire (Programme Partenaires). Ne s'active que si les modèles
   * sont câblés (les tests billing hérités ne les injectent pas → no-op).
   * Un remboursement annule la commission de la transaction concernée ; sinon,
   * un paiement d'un abonné référé inscrit une commission (net × taux, hold J+30).
   */
  async function handleCommission(userId, event) {
    if (!referrals || !partners || !commissions) return;
    const key = event.transaction_id || event.id;
    if (!key) return;

    if (isRefund(event)) {
      await commissions.reverseByEventId(key);
      return;
    }

    const referral = await referrals.findByProfile(userId);
    if (!referral) return; // membre non attribué → rien
    const partner = await partners.findById(referral.partnerId);
    if (!partner || partner.status === 'frozen') return;

    const firstPaymentAt = await commissions.firstOccurredAt(userId);
    const spec = computeCommission({ event, rateBps: partner.rateBps, firstPaymentAt, now: clock() });
    if (!spec) return;

    await commissions.record({ ...spec, partnerId: referral.partnerId, profileId: userId, eventId: key });
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
  referrals: defaultReferrals,
  partners: defaultPartners,
  commissions: defaultCommissions,
});

module.exports = { createBillingService, handleEvent: defaultService.handleEvent };
