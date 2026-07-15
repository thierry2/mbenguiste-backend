-- =============================================================================
--  Migration 003 — Realtime sur `matches`
-- =============================================================================
--  À exécuter APRÈS 002. Idempotent.
--
--  L'app s'abonne à UN seul canal global (useRealtimeSync) qui écoute aussi les
--  INSERT de `matches` : quand un like devient réciproque, le nouveau match doit
--  apparaître en direct dans « Vos routes se croisent », sans rafraîchir.
--  La policy SELECT `matches_read_own` (schema.sql) garantit que chacun ne reçoit
--  QUE les matchs auxquels il appartient.
-- =============================================================================
do $$
begin
  alter publication supabase_realtime add table public.matches;
exception
  when duplicate_object then null;  -- déjà dans la publication
end $$;
