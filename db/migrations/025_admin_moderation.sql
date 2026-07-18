-- =============================================================================
--  Migration 025 — Console de modération
-- =============================================================================
--  À exécuter dans Supabase AVANT le déploiement Railway. Idempotente.
--
--  La migration 024 a ouvert la collecte (signalements enrichis, dossiers
--  libres) ; celle-ci ouvre le TRAITEMENT. Sans elle, les dossiers s'empilent
--  en `status='open'` sans que personne puisse les clore : l'écran
--  « un humain va le lire » du centre de sécurité mentirait.
--
--  1. Traçabilité de la décision sur `reports` et `freeform_reports` :
--     qui a décidé quoi, quand, avec quelle note.
--  2. Index de file d'attente (les listes de la console lisent les 'open'
--     les plus récents d'abord).
-- =============================================================================

-- 1. Traçabilité --------------------------------------------------------------
alter table public.reports
  add column if not exists admin_note   text,
  add column if not exists admin_action text,          -- 'retirer' | 'restaurer' | 'rejeter'
  add column if not exists treated_at   timestamptz;

alter table public.freeform_reports
  add column if not exists admin_note   text,
  add column if not exists admin_action text,
  add column if not exists treated_at   timestamptz;

-- 2. File d'attente -----------------------------------------------------------
-- La console liste d'abord les dossiers ouverts, du plus récent au plus ancien.
create index if not exists idx_reports_status_created
  on public.reports (status, created_at desc);

-- L'index de l'unicité « un dossier ouvert par paire » (migration 014) reste :
-- clore un dossier libère la paire, la personne peut re-signaler plus tard si
-- le comportement recommence. C'est voulu.
