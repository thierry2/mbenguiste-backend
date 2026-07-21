-- =============================================================================
--  Migration 034 — le SERVEUR devient l'UNIQUE cerveau de l'Aventure
-- =============================================================================
--  Contexte (21/07) : le serveur résolvait déjà dans /answer, MAIS chaque client
--  rejouait le moteur en LOCAL (son propre `toursDesaccord`, son propre calcul
--  d'intime) pour afficher le clip et la question sans attendre un aller-retour.
--  Deux vérités qui ne se réconcilient jamais → intime vue par un seul, Joker qui
--  bloque l'autre. Cf. docs/audit-mystere.md §1 et docs/refactor-cerveau-unique.md.
--
--  Cette migration ajoute ce qu'il manque à `aventure_sessions` pour que la
--  session PORTE À ELLE SEULE tout ce que l'écran doit rendre — les deux clients
--  n'ont plus qu'à la LIRE, jamais à la recalculer.
--
--    · last_issue   — l'issue de la DERNIÈRE résolution (survie/mort/boucle),
--                      pour que l'écran sache si un clip de conséquence doit
--                      jouer, sans le redéduire lui-même.
--    · negocier      — ce désaccord doit-il ouvrir une négociation (question
--                      intime) ? Calculé par le serveur (`doitInjecterIntime`),
--                      plus par chaque client à partir de son propre compteur.
--    · clip_a_jouer  — la clé de clip que l'écran doit charger MAINTENANT (scène,
--                      reprise, ou conséquence). Le client ne choisit plus lui-
--                      même quel clip afficher.
--
--  `phase` existait déjà (031) sans contrainte : on la VERROUILLE ici sur les
--  valeurs que `domain/aventurePhase.js` (miroir serveur de `aventureMachine.ts`)
--  sait produire — un état hors de cette liste devient irreprésentable en base,
--  pas seulement dans le code.
-- =============================================================================

alter table public.aventure_sessions
  add column if not exists last_issue text
    check (last_issue in ('survie', 'mort', 'boucle')),
  add column if not exists negocier boolean not null default false,
  add column if not exists clip_a_jouer text;

-- `phase` verrouillée : idempotent (on retrouve la contrainte par sa définition,
-- jamais par un nom deviné — même piège que 033 sinon un nom non standard
-- survivrait au remplacement).
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'aventure_sessions'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%phase%';
  if c is not null then
    execute format('alter table public.aventure_sessions drop constraint %I', c);
  end if;
end $$;

alter table public.aventure_sessions add constraint aventure_sessions_phase_check
  check (phase in (
    'scene', 'choix', 'attente', 'absent', 'resolution',
    'consequence', 'recompense', 'reprise', 'negociation', 'suivant', 'fin'
  ));
