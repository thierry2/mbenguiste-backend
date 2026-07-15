-- =============================================================================
--  Migration 006 — Filtres de découverte enrichis
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Étend `match_preferences` (« ce que je veux voir ») :
--   • seeking_goal_id        : objectif recherché chez l'autre (relation, amitié…)
--   • regions                : grandes régions autorisées (vide = monde entier)
--   • require_common_language: ne montrer que les profils avec une langue commune
--   • min_photos / require_bio / verified_only : filtres qualité
--
--  On NE réactive PAS target_country comme filtre (doctrine mondiale). La colonne
--  max_distance_km reste inutilisée (pas de barrière de distance chez Mbenguiste).
-- =============================================================================

alter table public.match_preferences
  add column if not exists seeking_goal_id         uuid references public.relationship_goals(id),
  add column if not exists regions                 text[] not null default '{}',
  add column if not exists require_common_language  boolean not null default false,
  add column if not exists min_photos               smallint not null default 0,
  add column if not exists require_bio              boolean not null default false,
  add column if not exists verified_only            boolean not null default false;
