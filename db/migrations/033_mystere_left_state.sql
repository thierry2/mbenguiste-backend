-- =============================================================================
--  Migration 033 — l'état `left` (SORTIE PROPRE) manquait à la contrainte
-- =============================================================================
--  Bug 21/07 : `mystere_pairs.state` autorisait
--    ('proposed','active','won','lost','dissolved')
--  mais PAS 'left'. Or `etatApresIssue('left')` = 'left', et la sortie propre
--  (refus mutuel au consentement, OU « terminer le mystère » unilatéral) écrit
--  `state = 'left'`. La contrainte le rejetait, et l'erreur de l'update était
--  avalée → la paire restait 'active' → les deux membres VERROUILLÉS à vie
--  (le trigger « un seul mystère actif » leur interdisait tout nouveau mystère).
--
--  Fix additif : on remplace la contrainte CHECK par la même, augmentée de
--  'left'. Idempotente (drop if exists + add). À passer dans Supabase.
-- =============================================================================

-- On retrouve la contrainte CHECK qui gouverne `state` par sa DÉFINITION (et non
-- par un nom deviné) : une contrainte au nom non standard, laissée en place,
-- continuerait de rejeter 'left' malgré le add ci-dessous. Idempotent.
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'mystere_pairs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%state%';
  if c is not null then
    execute format('alter table public.mystere_pairs drop constraint %I', c);
  end if;
end $$;

alter table public.mystere_pairs add constraint mystere_pairs_state_check
  check (state in ('proposed','active','won','lost','left','dissolved'));
