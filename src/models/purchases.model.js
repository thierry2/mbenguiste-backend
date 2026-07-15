'use strict';
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Consommables achetés (Super Likes, Boosts, Jokers). Deux responsabilités :
//  - lire le catalogue (consumable_products) pour convertir un store_product_id
//    RevenueCat en { id, kind, quantity } ;
//  - tenir le registre des transactions déjà créditées (consumable_purchases)
//    pour garantir l'idempotence du webhook (RC réessaie les livraisons).
// Écritures backend only (service_role).
// ─────────────────────────────────────────────────────────────────────────────

/** → { id, kind, quantity } du produit, ou null s'il n'est pas au catalogue. */
async function findProductByStoreId(storeProductId) {
  const { data } = await supabase
    .from('consumable_products')
    .select('id, kind, quantity')
    .eq('store_product_id', storeProductId)
    .maybeSingle();
  return data ?? null;
}

/** Cette transaction store a-t-elle déjà été créditée ? */
async function wasProcessed(storeTransactionId) {
  if (!storeTransactionId) return false;
  const { data } = await supabase
    .from('consumable_purchases')
    .select('id')
    .eq('store_transaction_id', storeTransactionId)
    .maybeSingle();
  return !!data;
}

/** Enregistre la livraison d'un achat (marque la transaction comme traitée). */
async function record({ profileId, productId, storeTransactionId, quantity }) {
  const { error } = await supabase.from('consumable_purchases').insert({
    profile_id: profileId,
    product_id: productId,
    store_transaction_id: storeTransactionId,
    quantity,
  });
  if (error) throw error;
}

module.exports = { findProductByStoreId, wasProcessed, record };
