const config = require('../config');
const supabase = require('../config/supabase');
const profileModel = require('../models/profile.model');
const creditsModel = require('../models/credits.model');

// Événements RevenueCat qui ACTIVENT / prolongent l'abonnement Or.
const ACTIVATING = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED',
]);
// Événements qui coupent effectivement l'accès.
const DEACTIVATING = new Set(['EXPIRATION']);

/**
 * Traite un événement webhook RevenueCat. RC est la SOURCE DE VÉRITÉ ; on ne fait
 * que refléter son état chez nous : is_premium/premium_until pour l'abo, crédits
 * pour les consommables. Idempotent (rejeu sans effet de bord).
 *
 * `app_user_id` = notre profile.id (posé côté app via Purchases.logIn).
 */
async function handleEvent(event) {
  if (!event || !event.app_user_id) return;
  const userId = event.app_user_id;
  const type = event.type;

  // ── Consommable (Coup de cœur / Boost) ──
  if (type === 'NON_RENEWING_PURCHASE') {
    await grantConsumable(userId, event);
    return;
  }

  // ── Abonnement Or ──
  const ids = event.entitlement_ids || (event.entitlement_id ? [event.entitlement_id] : null);
  const concernsOr = !ids || ids.includes(config.revenuecat.entitlementId);

  if (ACTIVATING.has(type) && concernsOr) {
    const until = event.expiration_at_ms ? new Date(Number(event.expiration_at_ms)).toISOString() : null;
    await profileModel.setPremiumStatus(userId, { isPremium: true, premiumUntil: until });
    return;
  }
  if (DEACTIVATING.has(type)) {
    await profileModel.setPremiumStatus(userId, { isPremium: false, premiumUntil: null });
    return;
  }
  // CANCELLATION (auto-renouvellement coupé) : l'accès court jusqu'à EXPIRATION → rien à faire.
}

/** Crédite un achat de consommable, une seule fois (idempotence via transaction store). */
async function grantConsumable(userId, event) {
  const storeProductId = event.product_id;
  if (!storeProductId) return;

  const { data: product } = await supabase
    .from('consumable_products')
    .select('id, kind, quantity')
    .eq('store_product_id', storeProductId)
    .maybeSingle();
  if (!product) return;

  const txId = event.transaction_id || event.id || null;
  if (txId) {
    const { data: seen } = await supabase
      .from('consumable_purchases')
      .select('id')
      .eq('store_transaction_id', txId)
      .maybeSingle();
    if (seen) return; // déjà crédité
  }

  await creditsModel.grant(userId, {
    superLikes: product.kind === 'superlike' ? product.quantity : 0,
    boosts:     product.kind === 'boost'     ? product.quantity : 0,
  });

  await supabase.from('consumable_purchases').insert({
    profile_id: userId,
    product_id: product.id,
    store_transaction_id: txId,
    quantity: product.quantity,
  });
}

module.exports = { handleEvent };
