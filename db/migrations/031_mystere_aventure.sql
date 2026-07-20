-- =============================================================================
--  Migration 031 — Mystère & Aventure TEMPS RÉEL (appariement + sessions)
-- =============================================================================
--  À exécuter dans Supabase AVANT le déploiement Railway. Idempotente.
--
--  Ce que ça pose :
--   1. mystere_pairs      — l'appariement mutuel tiré à minuit (état + verrou).
--   2. aventure_sessions  — UNE aventure par paire (nœud courant, phase, issue).
--   3. aventure_answers   — la réponse de CHAQUE joueur, par nœud → le canal
--                            Realtime : c'est ça que l'autre voit arriver.
--
--  ⚠️ ANONYMAT — LA CONTRAINTE QUI GOUVERNE TOUT LE MODÈLE.
--  Le Mystère cache l'identité jusqu'à la révélation. Donc AUCUNE table lisible
--  par le client ne doit contenir le profile_id du partenaire :
--   · mystere_pairs est FERMÉE au client (comme app_settings / pending_likes) :
--     le backend seul (service_role) la lit et sert la carte masquée + un jeton
--     opaque. Le client ne voit jamais qui est en face.
--   · aventure_answers désigne l'auteur par son RÔLE dans la paire ('a' = le
--     user_low, 'b' = le user_high), JAMAIS par son id. En lisant les réponses
--     de l'autre en Realtime, je reçois « le joueur b a répondu X » — jamais son
--     identité. La correspondance rôle→id vit uniquement dans mystere_pairs,
--     fermée.
--   · Les policies RLS des sessions/réponses passent par une fonction
--     SECURITY DEFINER (`mystere_role`) qui, elle, a le droit de lire
--     mystere_pairs — sans jamais exposer son contenu au client.
--
--  Realtime (les 3 conditions maison) : publication ajoutée ici, policies SELECT
--  cohérentes ci-dessous, et `setAuth` reste à faire côté client. Sans les trois,
--  le Realtime échoue EN SILENCE.
-- =============================================================================

-- 1. L'APPARIEMENT ------------------------------------------------------------
-- Ordre user_low < user_high (comme matches) : le rôle 'a'/'b' est alors
-- déterministe et stable, et l'unicité de la paire est garantie par l'index.
create table if not exists public.mystere_pairs (
  id          uuid primary key default gen_random_uuid(),
  user_low    uuid not null references public.profiles(id) on delete cascade,
  user_high   uuid not null references public.profiles(id) on delete cascade,
  -- proposed  : tirée, encore SUBSTITUABLE (l'aventure n'a pas commencé)
  -- active    : l'aventure a commencé → VERROUILLÉE, jamais resubstituée
  -- won/lost  : aventure finie (révélation / échec)
  -- dissolved : défaite par une passe (l'un n'a jamais joué) — sans faute
  state       text not null default 'proposed'
              check (state in ('proposed','active','won','lost','dissolved')),
  drawn_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_pair_order check (user_low < user_high),
  unique (user_low, user_high)
);
create index if not exists idx_mystere_pairs_low  on public.mystere_pairs(user_low)  where state in ('proposed','active');
create index if not exists idx_mystere_pairs_high on public.mystere_pairs(user_high) where state in ('proposed','active');

-- UN SEUL mystère à la fois : personne ne peut avoir deux paires non terminales.
-- Un index unique ne suffit pas (on peut être low dans l'une, high dans l'autre) :
-- il faut regarder les DEUX colonnes → trigger.
create or replace function public.mystere_one_active() returns trigger
language plpgsql as $$
begin
  if new.state in ('proposed','active') then
    if exists (
      select 1 from public.mystere_pairs p
      where p.id <> new.id
        and p.state in ('proposed','active')
        and (p.user_low  in (new.user_low, new.user_high)
          or p.user_high in (new.user_low, new.user_high))
    ) then
      raise exception 'mystere: un participant a déjà un mystère actif';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists mystere_one_active_trg on public.mystere_pairs;
create trigger mystere_one_active_trg
  before insert or update on public.mystere_pairs
  for each row execute function public.mystere_one_active();

-- Mon rôle dans une paire, SANS exposer la paire au client. SECURITY DEFINER :
-- la fonction lit mystere_pairs (fermée) au nom du propriétaire, et ne renvoie
-- qu'un rôle 'a'/'b' — jamais l'id du partenaire.
create or replace function public.mystere_role(p_pair uuid, p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.user_low  = p_uid then 'a'
    when p.user_high = p_uid then 'b'
    else null
  end
  from public.mystere_pairs p
  where p.id = p_pair;
$$;

alter table public.mystere_pairs enable row level security;
-- Aucune policy : FERMÉE au client (le backend service_role fait tout).

-- 2. LA SESSION D'AVENTURE ----------------------------------------------------
create table if not exists public.aventure_sessions (
  id            uuid primary key default gen_random_uuid(),
  pair_id       uuid not null references public.mystere_pairs(id) on delete cascade,
  graph_id      text not null,
  current_node  text not null,
  phase         text not null default 'scene',
  outcome       text check (outcome in ('match','echec','left')), -- null tant qu'en cours
  joker_used    boolean not null default false,
  tours_desaccord int not null default 0, -- mémoire de la boucle de désaccord (par nœud)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (pair_id)                       -- une seule aventure par paire
);
-- Idempotence : si la table existait déjà sans la colonne (031 partiellement passée).
alter table public.aventure_sessions add column if not exists tours_desaccord int not null default 0;
create index if not exists idx_aventure_sessions_pair on public.aventure_sessions(pair_id);

alter table public.aventure_sessions enable row level security;
-- Les deux membres LISENT leur session (via le rôle, sans voir l'autre id).
drop policy if exists aventure_sessions_read on public.aventure_sessions;
create policy aventure_sessions_read on public.aventure_sessions
  for select to authenticated
  using (public.mystere_role(pair_id, auth.uid()) is not null);
-- Aucune écriture cliente : c'est le BACKEND qui fait avancer le nœud et pose
-- l'issue (sinon un client mentirait sur sa victoire → révélation volée).

-- 3. LES RÉPONSES (le canal Realtime) -----------------------------------------
-- Une réponse par nœud et par rôle. `role` et non un profile_id : c'est ce qui
-- rend l'anonymat tenable même pendant qu'on joue à deux.
create table if not exists public.aventure_answers (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.aventure_sessions(id) on delete cascade,
  node_id       text not null,
  role          text not null check (role in ('a','b')),
  answer_index  int,        -- choix A/B (0 ou 1) ; null pour une réponse intime
  message_text  text,       -- réponse intime, DÉJÀ filtrée par le serveur
  created_at    timestamptz not null default now(),
  unique (session_id, node_id, role)
);
create index if not exists idx_aventure_answers_session on public.aventure_answers(session_id);

alter table public.aventure_answers enable row level security;
-- LECTURE : les deux membres voient toutes les réponses de LEUR session (c'est
-- ce qui fait arriver la réponse de l'autre en Realtime). Jamais celles d'autrui.
drop policy if exists aventure_answers_read on public.aventure_answers;
create policy aventure_answers_read on public.aventure_answers
  for select to authenticated
  using (exists (
    select 1 from public.aventure_sessions s
    where s.id = aventure_answers.session_id
      and public.mystere_role(s.pair_id, auth.uid()) is not null
  ));
-- ÉCRITURE : je ne peux insérer QUE sous mon propre rôle, et seulement dans une
-- session dont je suis membre. `role` usurpé → mystere_role renvoie l'autre
-- lettre (ou null) → le with check échoue.
drop policy if exists aventure_answers_write on public.aventure_answers;
create policy aventure_answers_write on public.aventure_answers
  for insert to authenticated
  with check (role = public.mystere_role(
    (select s.pair_id from public.aventure_sessions s where s.id = aventure_answers.session_id),
    auth.uid()
  ));

-- 4. REALTIME -----------------------------------------------------------------
-- Sans ça, aucun changement n'est diffusé. Guardé : la publication peut déjà
-- contenir la table (idempotence), et n'existe pas hors Supabase.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.aventure_answers;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table public.aventure_sessions;
    exception when duplicate_object then null; end;
  end if;
end $$;

-- 5. RÉGLAGES À CHAUD (app_settings) — l'heure et les planchers NE SONT PAS
--    figés dans le code (exigence du cahier). Modifiables par UPDATE SQL.
insert into public.app_settings (key, value) values
  ('mystere.draw_hour_utc',      '21'::jsonb),   -- ⚠ instant ABSOLU (pas local)
  ('mystere.window_minutes',     '120'::jsonb),  -- la fenêtre DURE (tolère les retards)
  ('mystere.pass_minutes',       '10'::jsonb),   -- une passe toutes les ~10 min
  ('mystere.floor_in_window',    '10'::jsonb),   -- plancher pendant la fenêtre
  ('mystere.floor_out_window',   '20'::jsonb),   -- plancher hors fenêtre (PLUS HAUT)
  ('mystere.assortative_weight', '20'::jsonb)    -- écart de désirabilité (assortatif)
on conflict (key) do nothing;
