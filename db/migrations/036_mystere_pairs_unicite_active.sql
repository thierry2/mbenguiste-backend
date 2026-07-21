-- =============================================================================
-- 036 — L'UNICITÉ D'UNE PAIRE NE VAUT QUE TANT QU'ELLE EST VIVANTE.
--
-- `mystere_pairs` portait `unique (user_low, user_high)` SANS condition d'état.
-- Conséquence : deux personnes qui ont terminé un mystère ensemble — gagné,
-- quitté, ou dissous — ne pouvaient plus JAMAIS être appariées. La ligne
-- terminale restait et bloquait toute nouvelle insertion.
--
-- Deux dégâts, un visible et un qui l'était moins :
--   · en test, `forcePair` échoue dès la deuxième tentative sur les deux mêmes
--     comptes (violation de contrainte) — il fallait supprimer la ligne à la
--     main entre chaque essai ;
--   · en production, la passe d'appariement écarte silencieusement un couple
--     compatible parce qu'ils se sont croisés une fois. Sur un vivier jeune,
--     ça retire des candidats sans que personne ne le voie.
--
-- L'unicité DEVIENT PARTIELLE : deux personnes ne peuvent avoir qu'un seul
-- mystère NON TERMINAL à la fois — ce qui est la vraie règle métier — mais leur
-- historique n'interdit plus l'avenir. La garantie « un seul mystère à la fois
-- par personne » reste, elle, tenue par le trigger `mystere_one_active_trg`,
-- qui est plus strict et n'est pas touché ici.
--
-- Idempotent : relançable sans risque.
-- =============================================================================

-- La contrainte d'origine est nommée par Postgres (mystere_pairs_user_low_user_high_key)
-- mais on ne s'y fie pas : on la retrouve par sa DÉFINITION.
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'mystere_pairs'
    and con.contype = 'u'
    and pg_get_constraintdef(con.oid) = 'UNIQUE (user_low, user_high)';
  if c is not null then
    execute format('alter table public.mystere_pairs drop constraint %I', c);
  end if;
end $$;

-- Un seul mystère VIVANT par duo. Les paires terminées ('won', 'lost', 'left',
-- 'dissolved') s'accumulent librement : c'est l'historique, il ne bloque rien.
create unique index if not exists uniq_mystere_pair_vivante
  on public.mystere_pairs (user_low, user_high)
  where state in ('proposed', 'active');

-- PostgREST relit son cache de schéma.
notify pgrst, 'reload schema';
