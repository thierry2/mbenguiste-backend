-- =============================================================================
--  Migration 014 — Durcissement du signalement (logique AfrikMoms)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  • Idempotence : UN seul dossier OUVERT par (signaleur, signalé) — re-signaler
--    la même personne ne crée pas de doublon (index partiel unique).
--  • Perf modération : index sur la cible (compter/lister les dossiers d'un profil).
-- =============================================================================

create unique index if not exists uniq_open_report_per_pair
  on public.reports (reporter_id, reported_id)
  where status = 'open';

create index if not exists idx_reports_reported
  on public.reports (reported_id);
