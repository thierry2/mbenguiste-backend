-- =============================================================================
--  Migration 004 — Réglages utilisateur (notifications + visibilité)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Ajoute sur `profiles` :
--   • préférences de notifications (push / e-mail / sms) — stockées même si la
--     livraison push OS n'est pas encore branchée ;
--   • contrôles de visibilité :
--       - is_discoverable   : profil en pause (invisible dans la découverte) ;
--       - incognito         : premium — visible SEULEMENT par les gens que j'ai
--                             likés / qui m'ont likée (géré côté discovery.model) ;
--       - hide_online_status: masque « en ligne » (last_active_at non exposé).
-- =============================================================================

alter table public.profiles
  add column if not exists notif_push          boolean not null default true,
  add column if not exists notif_email         boolean not null default true,
  add column if not exists notif_sms           boolean not null default false,
  add column if not exists is_discoverable      boolean not null default true,
  add column if not exists incognito            boolean not null default false,
  add column if not exists hide_online_status   boolean not null default false;
