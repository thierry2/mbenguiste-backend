'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE PLAN DE MIGRATION — partagé par tous les scripts.
//
// Une seule liste, pour qu'ajouter une table demain ne demande pas de penser à
// trois fichiers. Une table oubliée ici ne lève aucune erreur : elle est juste
// absente de la destination, et on s'en aperçoit des semaines plus tard.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tables de RÉFÉRENCE, seedées par `schema.sql` avec des `gen_random_uuid()` —
 * donc des identifiants DIFFÉRENTS de la source. Les recopier telles quelles
 * violerait l'unicité sur `code` ; ne rien faire laisserait `profiles.gender_id`
 * pointer dans le vide. D'où l'option `--reset-ref`, qui les vide avant copie.
 */
const REFERENCE = new Set([
  'genders', 'relationship_goals', 'interests', 'prompts', 'swipe_actions',
  'report_reasons', 'subscription_plans', 'lifestyle_options', 'consumable_products',
]);

/**
 * L'ORDRE DES CLÉS ÉTRANGÈRES : un parent avant ses enfants, toujours.
 * `conflict` = la clé primaire, ce qui rend chaque copie REJOUABLE sans doublon.
 */
const TABLES = [
  { t: 'genders', conflict: 'id' },
  { t: 'relationship_goals', conflict: 'id' },
  { t: 'interests', conflict: 'id' },
  { t: 'prompts', conflict: 'id' },
  { t: 'swipe_actions', conflict: 'id' },
  { t: 'report_reasons', conflict: 'id' },
  { t: 'subscription_plans', conflict: 'id' },
  { t: 'lifestyle_options', conflict: 'id' },
  { t: 'consumable_products', conflict: 'id' },
  { t: 'app_settings', conflict: 'key' },
  { t: 'aventure_graphs', conflict: 'id' },
  { t: 'partners', conflict: 'id' },
  { t: 'profiles', conflict: 'id' },
  { t: 'profile_photos', conflict: 'id' },
  { t: 'profile_interests', conflict: 'profile_id,interest_id' },
  { t: 'profile_prompts', conflict: 'id' },
  { t: 'match_preferences', conflict: 'profile_id' },
  { t: 'swipes', conflict: 'swiper_id,target_id' },
  { t: 'matches', conflict: 'id' },
  { t: 'blocks', conflict: 'blocker_id,blocked_id' },
  { t: 'reports', conflict: 'id' },
  { t: 'subscriptions', conflict: 'id' },
  { t: 'user_credits', conflict: 'profile_id' },
  { t: 'usage_counters', conflict: 'profile_id,kind' },
  { t: 'consumable_purchases', conflict: 'id' },
  { t: 'recurring_grants', conflict: 'profile_id,kind,period_key' },
  { t: 'deck_events', conflict: 'id' },
  { t: 'profile_engagement', conflict: 'profile_id' },
  { t: 'deck_impressions', conflict: 'viewer_id,target_id' },
  { t: 'pending_likes', conflict: 'target_id,swiper_id' },
  { t: 'freeform_reports', conflict: 'id' },
  { t: 'verification_requests', conflict: 'id' },
  { t: 'push_tokens', conflict: 'token' },
  { t: 'promo_codes', conflict: 'code' },
  { t: 'mystere_pairs', conflict: 'id' },
  { t: 'messages', conflict: 'id' },
  { t: 'referrals', conflict: 'profile_id' },
  { t: 'partner_payouts', conflict: 'id' },
  { t: 'aventure_sessions', conflict: 'id' },
  { t: 'commission_ledger', conflict: 'id' },
  { t: 'aventure_answers', conflict: 'id' },
];

/**
 * ⚠ LA VISIBILITÉ EST UNE QUESTION DE VIE PRIVÉE, PAS D'AFFICHAGE.
 * Créer `chat-media` ou `verification-selfies` en public, c'est exposer des
 * conversations privées et des pièces d'identité à qui devine une URL.
 */
const BUCKETS = [
  { nom: 'photos', public: true },
  { nom: 'aventure', public: true },
  { nom: 'chat-media', public: false },
  { nom: 'verification-selfies', public: false },
];

module.exports = { TABLES, REFERENCE, BUCKETS };
