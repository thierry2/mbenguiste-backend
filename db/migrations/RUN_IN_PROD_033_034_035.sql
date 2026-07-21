-- =============================================================================
-- À PASSER EN PROD (Supabase → SQL Editor) — consolidé 033 + 034 + 035.
-- Idempotent : relançable sans risque. Cf. docs/audit-mystere.md,
-- docs/refactor-cerveau-unique.md, et les migrations individuelles 033/034/035.
-- APRÈS ce script : redéployer le backend (le code lit/écrit ces colonnes).
-- =============================================================================

-- ── 033 : l'état 'left' (sortie propre) manquait à la contrainte ─────────────
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'mystere_pairs'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%state%';
  if c is not null then execute format('alter table public.mystere_pairs drop constraint %I', c); end if;
end $$;
alter table public.mystere_pairs add constraint mystere_pairs_state_check
  check (state in ('proposed','active','won','lost','left','dissolved'));

-- ── 034 : colonnes du CERVEAU UNIQUE + phase verrouillée ─────────────────────
alter table public.aventure_sessions
  add column if not exists tours_desaccord int not null default 0,
  add column if not exists last_issue text check (last_issue in ('survie','mort','boucle')),
  add column if not exists negocier boolean not null default false,
  add column if not exists clip_a_jouer text;

do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'aventure_sessions'
    and con.contype = 'c' and pg_get_constraintdef(con.oid) ilike '%phase%';
  if c is not null then execute format('alter table public.aventure_sessions drop constraint %I', c); end if;
end $$;
alter table public.aventure_sessions add constraint aventure_sessions_phase_check
  check (phase in (
    'scene','choix','attente','absent','resolution',
    'consequence','recompense','reprise','negociation','suivant','fin'
  ));

-- ── 035 : fermer l'écriture client sur aventure_answers (sécurité) ───────────
drop policy if exists aventure_answers_write on public.aventure_answers;

-- ── Recharger le cache de schéma PostgREST ───────────────────────────────────
notify pgrst, 'reload schema';
