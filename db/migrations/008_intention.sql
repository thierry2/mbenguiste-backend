-- =============================================================================
--  Migration 008 — Intention du voyage (le sens de la route)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Le cœur de Mbenguiste : deux archétypes complémentaires —
--   • 'depart' (l'envol)  : je vis ici, je rêve de vivre l'amour ailleurs ;
--   • 'return' (le retour) : je veux trouver l'amour au pays / de mes origines ;
--   • 'any'                : l'amour d'abord, peu importe la frontière.
--  Sert à colorer les cartes et à prioriser les paires complémentaires
--  (depart ↔ return) dans la découverte.
-- =============================================================================

alter table public.profiles
  add column if not exists intention text;   -- 'depart' | 'return' | 'any' | null
