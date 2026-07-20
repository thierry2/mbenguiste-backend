-- =============================================================================
--  Mbenguiste — dating app database schema (Supabase / PostgreSQL)
-- =============================================================================
--  Mbenguiste connects hearts across borders. A member is defined by a ROUTE:
--  where they live now  ->  where they dream of loving.
--  The app is origin-neutral: an Abidjan member may seek a French (non-African)
--  partner, and vice-versa. Nothing here assumes a shared origin.
--
--  This file is runnable top-to-bottom in the Supabase SQL editor.
--  It creates: reference tables (+ seeds), core tables, indexes, the
--  mutual-like -> match trigger, and Row Level Security policies.
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "postgis";        -- geography(Point) for distance (optional, see note)
create extension if not exists vector;           -- pgvector : halfvec + HNSW (embeddings photo, cf. §14)

-- =============================================================================
--  1. REFERENCE TABLES (lookup / enums-as-tables, same style as AfrikMoms)
-- =============================================================================

create table if not exists public.genders (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- 'woman' | 'man'
  display_name text not null,
  display_order smallint not null default 0
);

create table if not exists public.relationship_goals (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- 'serious' | 'marriage' | 'friendship' | 'unsure'
  display_name text not null,
  display_order smallint not null default 0
);

create table if not exists public.interests (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  display_name text not null,
  category     text,                          -- 'music' | 'food' | 'lifestyle' ...
  display_order smallint not null default 0
);

create table if not exists public.prompts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  question     text not null,                 -- "A perfect Sunday looks like..."
  display_order smallint not null default 0
);

create table if not exists public.swipe_actions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- 'pass' | 'like' | 'super_like'
  display_name text not null
);

create table if not exists public.report_reasons (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  display_name text not null,
  display_order smallint not null default 0
);

-- Lifestyle descriptors (Hinge-style), grouped by `kind`. Single choice per kind,
-- stored on profiles.lifestyle jsonb as {kind: code}.
create table if not exists public.lifestyle_options (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  code          text not null,
  display_name  text not null,
  display_order smallint not null default 0,
  unique (kind, code)
);

create table if not exists public.subscription_plans (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,         -- 'plus_1m' | 'gold_6m' | 'prestige_3m' ...
  store_product_id  text,                         -- 'com.mbenguiste.or.1m' ... (IAP, IMMUABLE)
  display_name      text not null,
  tier              text not null default 'or',   -- 'plus' | 'or' | 'prestige' (doctrine 15/07)
  period            text not null default 'month',-- 'week' | 'month'
  months            smallint not null,            -- durée en mois (0 pour les formules hebdo)
  price_eur         numeric(6,2) not null,
  display_order     smallint not null default 0
);

-- Idempotent : rattrape les bases créées avant l'ajout des colonnes (IAP + paliers).
alter table public.subscription_plans
  add column if not exists store_product_id text,
  add column if not exists tier             text not null default 'or',
  add column if not exists period           text not null default 'month';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_plans_tier_chk') then
    alter table public.subscription_plans add constraint subscription_plans_tier_chk
      check (tier in ('plus', 'or', 'prestige'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscription_plans_period_chk') then
    alter table public.subscription_plans add constraint subscription_plans_period_chk
      check (period in ('week', 'month'));
  end if;
end $$;

-- =============================================================================
--  2. PROFILES  (1:1 with auth.users)
-- =============================================================================

create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  first_name         text not null,
  birth_date         date not null,                       -- age is derived, never trusted from client
  gender_id          uuid references public.genders(id),
  bio                text,
  avatar_url         text,

  -- WHERE THEY ARE  (origin of the route)
  current_country    text,                                -- ISO-3166 alpha-2, e.g. 'CI'
  current_city       text,
  current_geo        geography(Point, 4326),              -- for distance sorting (nullable)

  -- WHERE THEY DREAM OF LOVING  (destination of the route — the signature)
  target_country     text,                                -- e.g. 'FR'
  target_city        text,
  open_to_relocate   boolean not null default false,

  relationship_goal_id uuid references public.relationship_goals(id),
  -- Intention du voyage : 'depart' (l'envol) | 'return' (le retour) | 'any' | null.
  intention          text,
  primary_language   text,                                -- e.g. 'fr'
  spoken_languages   text[] not null default '{}',

  -- Descripteurs de carte d'identité (vitrine du profil consulté).
  height_cm          smallint,                            -- taille en cm (100–250)
  origin_country     text,                                -- pays d'ORIGINE (ISO alpha-2), distinct de current_country
  occupation         text,                                -- métier / profession, texte libre

  is_verified        boolean not null default false,      -- photo/ID verification
  verified_at        timestamptz,                         -- quand le sceau a été accordé (migration 030)
  is_premium         boolean not null default false,      -- denormalized cache of an active subscription
  premium_until      timestamptz,

  push_token         text,
  last_active_at     timestamptz not null default now(),
  onboarding_done    boolean not null default false,

  -- Notification preferences (delivery wiring is separate).
  notif_push         boolean not null default true,
  notif_email        boolean not null default true,
  notif_sms          boolean not null default false,
  -- Visibility controls.
  is_discoverable    boolean not null default true,     -- false = profile paused (hidden from discovery)
  incognito          boolean not null default false,    -- premium: visible only to people I liked / who liked me
  hide_online_status boolean not null default false,    -- hide "online" (last_active_at not exposed)
  -- Lifestyle descriptors: {kind: code} — see lifestyle_options.
  lifestyle          jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Soft delete: never auth.admin.deleteUser(). Anonymize + block via middleware.
  scheduled_deletion_at timestamptz,
  deleted_at         timestamptz,

  constraint chk_target_not_self check (true)
);

comment on column public.profiles.current_country is 'Origin of the "route" shown on every card.';
comment on column public.profiles.target_country  is 'Destination of the "route" — Mbenguiste signature.';

-- Idempotent : soigne les bases dont `profiles` précède l'ajout de ces colonnes
-- (évite « could not find the X column in the schema cache » au re-run).
alter table public.profiles
  add column if not exists email                text,
  add column if not exists gender_id            uuid references public.genders(id),
  add column if not exists bio                  text,
  add column if not exists avatar_url           text,
  add column if not exists current_country      text,
  add column if not exists current_city         text,
  add column if not exists target_country       text,
  add column if not exists target_city          text,
  add column if not exists open_to_relocate     boolean not null default false,
  add column if not exists relationship_goal_id uuid references public.relationship_goals(id),
  add column if not exists intention            text,
  add column if not exists primary_language     text,
  add column if not exists spoken_languages     text[] not null default '{}',
  add column if not exists is_verified          boolean not null default false,
  add column if not exists is_premium           boolean not null default false,
  add column if not exists premium_until        timestamptz,
  add column if not exists premium_tier         text,
  add column if not exists push_token           text,
  add column if not exists last_active_at       timestamptz not null default now(),
  add column if not exists onboarding_done      boolean not null default false,
  add column if not exists notif_push           boolean not null default true,
  add column if not exists notif_email          boolean not null default true,
  add column if not exists notif_sms            boolean not null default false,
  add column if not exists is_discoverable      boolean not null default true,
  add column if not exists incognito            boolean not null default false,
  add column if not exists hide_online_status   boolean not null default false,
  add column if not exists lifestyle            jsonb not null default '{}'::jsonb,
  add column if not exists height_cm            smallint,
  add column if not exists origin_country       text,
  add column if not exists occupation           text,
  add column if not exists scheduled_deletion_at timestamptz,
  add column if not exists deleted_at           timestamptz;

-- Multiple photos per profile (gallery on the discovery card).
create table if not exists public.profile_photos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  url         text not null,
  position    smallint not null default 0,               -- 0 = main photo
  created_at  timestamptz not null default now()
);

-- Interests (many-to-many).
create table if not exists public.profile_interests (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  primary key (profile_id, interest_id)
);

-- Prompt answers (Hinge-style, shown on the profile screen).
create table if not exists public.profile_prompts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  prompt_id   uuid not null references public.prompts(id),
  answer      text not null,
  position    smallint not null default 0,
  unique (profile_id, prompt_id)
);

-- Discovery filters (one row per user).
create table if not exists public.match_preferences (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  seeking_gender_id uuid references public.genders(id),    -- null = anyone
  min_age         smallint not null default 18,
  max_age         smallint not null default 60,
  max_distance_km integer,                                 -- unused: no distance barrier on Mbenguiste
  target_country  text,                                    -- unused as filter (worldwide doctrine)
  seeking_goal_id uuid references public.relationship_goals(id),  -- other's goal (null = any)
  regions         text[] not null default '{}',            -- allowed macro-regions (empty = worldwide)
  require_common_language boolean not null default false,  -- only profiles sharing a language with me
  min_photos      smallint not null default 0,             -- quality: minimum photo count
  require_bio     boolean not null default false,          -- quality: must have a bio
  verified_only   boolean not null default false,          -- quality: verified profiles only
  updated_at      timestamptz not null default now()
);

-- =============================================================================
--  3. SWIPES  &  MATCHES
-- =============================================================================

create table if not exists public.swipes (
  swiper_id   uuid not null references public.profiles(id) on delete cascade,
  target_id   uuid not null references public.profiles(id) on delete cascade,
  action_id   uuid not null references public.swipe_actions(id),
  -- Like ciblé (« aimer ce détail », façon Hinge) — voir migration 013.
  like_target_type text,                                 -- 'photo' | 'prompt' | null (like global)
  like_target_ref  text,                                 -- id de photo ou code de prompt
  like_comment     text,                                 -- petit mot joint au like (amorce au match)
  created_at  timestamptz not null default now(),
  primary key (swiper_id, target_id),
  constraint chk_no_self_swipe check (swiper_id <> target_id),
  constraint chk_like_target_type check (like_target_type is null or like_target_type in ('photo', 'prompt'))
);
create index if not exists idx_swipes_target on public.swipes(target_id);
-- Idempotent : rattrape les bases créées avant l'ajout du like ciblé.
alter table public.swipes
  add column if not exists like_target_type text,
  add column if not exists like_target_ref  text,
  add column if not exists like_comment     text;

-- A match is a mutual like. We store the pair canonically (user_low < user_high)
-- so the unique constraint prevents duplicate matches regardless of who liked first.
create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  user_low      uuid not null references public.profiles(id) on delete cascade,
  user_high     uuid not null references public.profiles(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_message_at timestamptz,
  is_active     boolean not null default true,            -- set false on unmatch/block
  ended_at      timestamptz,                              -- date de l'unmatch/blocage (null = avant migration 024)
  constraint chk_match_order check (user_low < user_high),
  unique (user_low, user_high)
);
create index if not exists idx_matches_user_low  on public.matches(user_low);
create index if not exists idx_matches_user_high on public.matches(user_high);

-- =============================================================================
--  4. MESSAGES
-- =============================================================================

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches(id) on delete cascade,
  sender_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,                            -- shown text (translated if applicable)
  original_body text,                                     -- author's original (slang/other language)
  source_language text,                                   -- detected language/argot of original_body
  is_translated boolean not null default false,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists idx_messages_match on public.messages(match_id, created_at);

-- =============================================================================
--  5. SAFETY  &  BILLING
-- =============================================================================

create table if not exists public.blocks (
  blocker_id  uuid not null references public.profiles(id) on delete cascade,
  blocked_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint chk_no_self_block check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  reported_id  uuid not null references public.profiles(id) on delete cascade,
  reason_id    uuid references public.report_reasons(id),
  details      text,
  status       text not null default 'open',              -- 'open' | 'reviewing' | 'closed'
  created_at   timestamptz not null default now(),
  -- Traçabilité de la décision (migration 025, console de modération).
  admin_note   text,
  admin_action text,                                      -- 'retirer' | 'restaurer' | 'rejeter'
  treated_at   timestamptz
);
create index if not exists idx_reports_status_created on public.reports (status, created_at desc);
-- Idempotence : un seul dossier OUVERT par (signaleur, signalé) — cf. migration 014.
create unique index if not exists uniq_open_report_per_pair
  on public.reports (reporter_id, reported_id) where status = 'open';
create index if not exists idx_reports_reported on public.reports (reported_id);

-- Dossier LIBRE (migration 024) : signaler une personne introuvable dans ses
-- connexions (« son profil n'apparaît pas ici ») — texte descriptif, l'équipe
-- retrouve le profil à la main. Même anonymat que reports.
create table if not exists public.freeform_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  status       text not null default 'open',              -- 'open' | 'reviewing' | 'closed'
  created_at   timestamptz not null default now(),
  -- Traçabilité de la décision (migration 025, console de modération).
  admin_note   text,
  admin_action text,
  treated_at   timestamptz,
  constraint chk_freeform_body_len check (char_length(body) between 20 and 2000)
);
create index if not exists idx_freeform_reports_status on public.freeform_reports (status, created_at);
-- RLS sans aucune policy = refus total côté clé anon (celle embarquée dans
-- l'app). Seule la clé service, côté backend, lit ces récits. Même régime que
-- `reports` : ces deux tables ne doivent JAMAIS être joignables depuis le client.
alter table public.freeform_reports enable row level security;

-- Vérification par selfie (migration 030) : le serveur tire une pose au hasard,
-- la personne prend un selfie EN DIRECT, un humain valide → is_verified = true.
-- Le bucket privé `verification-selfies` et les policies Storage vivent dans la
-- migration (elles dépendent du schéma `storage` de Supabase, absent ici).
create table if not exists public.verification_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  pose_code          text not null,                    -- pose imposée, tirée au hasard
  selfie_path        text,                             -- chemin bucket PRIVÉ (null tant que pas capturé)
  status             text not null default 'awaiting_selfie',
  attempt_no         int  not null default 1,          -- n° de tentative (cooldown après rejet)
  capture_expires_at timestamptz,                      -- fin de la fenêtre de CAPTURE (start→envoi) uniquement
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        text,                             -- marqueur admin
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  constraint chk_verification_status check (
    status in ('awaiting_selfie', 'pending_review', 'approved', 'rejected', 'expired')
  )
);
-- Au plus UNE requête active par personne (capture en cours OU en attente de revue).
create unique index if not exists uniq_active_verification_per_user
  on public.verification_requests (user_id)
  where status in ('awaiting_selfie', 'pending_review');
create index if not exists idx_verification_review_queue
  on public.verification_requests (status, submitted_at);
create index if not exists idx_verification_user
  on public.verification_requests (user_id, created_at desc);
-- RLS : la personne ne touche que ses propres demandes ; le backend service_role
-- (console admin) contourne la RLS. Aucune fuite côté clé anon.
alter table public.verification_requests enable row level security;
drop policy if exists verification_own on public.verification_requests;
create policy verification_own on public.verification_requests
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  plan_id      uuid not null references public.subscription_plans(id),
  status       text not null default 'active',            -- 'active' | 'expired' | 'cancelled'
  store        text,                                      -- 'apple' | 'google'
  store_receipt text,
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_subscriptions_profile on public.subscriptions(profile_id);

-- =============================================================================
--  6. MUTUAL-LIKE  ->  MATCH  (trigger)
-- =============================================================================
-- When a like/super_like is inserted, if the target already liked the swiper,
-- create the match (canonical order). Runs with definer rights so it can read
-- the reciprocal swipe regardless of RLS.

-- (023) swipes est un UPSERT (swipe.model.record) : un changement d'avis sur une
-- paire déjà swipée est un UPDATE — le trigger doit aussi l'écouter, sinon un
-- « pass puis re-like » face à un like en attente ne crée JAMAIS le match (même
-- classe de bug que le « like fantôme » corrigé en 022 pour pending_likes).
create or replace function public.handle_swipe() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action_code text;
  v_reciprocal  boolean;
  v_low  uuid;
  v_high uuid;
begin
  select code into v_action_code from public.swipe_actions where id = new.action_id;
  if v_action_code = 'pass' then
    return new;                                           -- a pass never creates a match
  end if;

  select exists (
    select 1
    from public.swipes s
    join public.swipe_actions a on a.id = s.action_id
    where s.swiper_id = new.target_id
      and s.target_id = new.swiper_id
      and a.code in ('like', 'super_like')
  ) into v_reciprocal;

  if v_reciprocal
     -- Jamais de match (ni de résurrection) entre bloqués, quel que soit le sens.
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = new.swiper_id and b.blocked_id = new.target_id)
          or (b.blocker_id = new.target_id and b.blocked_id = new.swiper_id)
     ) then
    if new.swiper_id < new.target_id then
      v_low := new.swiper_id; v_high := new.target_id;
    else
      v_low := new.target_id; v_high := new.swiper_id;
    end if;

    -- Réactivation voulue : si la paire avait un match désactivé par un unmatch
    -- (pas un block — exclu ci-dessus), un like frais rouvre le MÊME fil.
    insert into public.matches (user_low, user_high, last_message_at)
    values (v_low, v_high, now())
    on conflict (user_low, user_high) do update set is_active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handle_swipe on public.swipes;
create trigger trg_handle_swipe
  after insert or update on public.swipes
  for each row execute function public.handle_swipe();

-- Bump matches.last_message_at on each new message (drives the conversation list order).
create or replace function public.touch_match_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.matches set last_message_at = new.created_at where id = new.match_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_match on public.messages;
create trigger trg_touch_match
  after insert on public.messages
  for each row execute function public.touch_match_on_message();

-- =============================================================================
--  7. ROW LEVEL SECURITY
-- =============================================================================
-- The backend uses the service_role key (bypasses RLS). These policies protect
-- direct client access (Realtime subscriptions for live chat, and any future
-- client-side reads). Discovery / matching go through the backend.

alter table public.profiles          enable row level security;
alter table public.profile_photos    enable row level security;
alter table public.profile_interests enable row level security;
alter table public.profile_prompts   enable row level security;
alter table public.match_preferences enable row level security;
alter table public.swipes            enable row level security;
alter table public.matches           enable row level security;
alter table public.messages          enable row level security;
alter table public.blocks            enable row level security;
alter table public.reports           enable row level security;
alter table public.subscriptions     enable row level security;

-- Profiles: any authenticated user can read non-deleted profiles (discovery);
-- a user can only edit their own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (deleted_at is null);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Matches: a user sees only matches they belong to.
drop policy if exists matches_read_own on public.matches;
create policy matches_read_own on public.matches
  for select to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- Messages: a user reads/writes messages only in matches they belong to.
-- (This is what makes Realtime chat deliver safely without a server filter.)
drop policy if exists messages_read_own on public.messages;
create policy messages_read_own on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (auth.uid() = m.user_low or auth.uid() = m.user_high)
    )
  );
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and m.is_active
        and (auth.uid() = m.user_low or auth.uid() = m.user_high)
    )
  );

-- Swipes / blocks / reports / subscriptions: a user only touches their own rows.
drop policy if exists swipes_own on public.swipes;
create policy swipes_own on public.swipes
  for all to authenticated using (swiper_id = auth.uid()) with check (swiper_id = auth.uid());
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
drop policy if exists prefs_own on public.match_preferences;
create policy prefs_own on public.match_preferences
  for all to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- =============================================================================
--  8. SEED DATA  (reference tables)
-- =============================================================================

insert into public.genders (code, display_name, display_order) values
  ('woman','Femme',1), ('man','Homme',2)
on conflict (code) do nothing;

insert into public.relationship_goals (code, display_name, display_order) values
  ('serious','Relation sérieuse',1),
  ('marriage','Mariage',2),
  ('friendship','Amitié d''abord',3),
  ('unsure','Je verrai',4)
on conflict (code) do nothing;

insert into public.swipe_actions (code, display_name) values
  ('pass','Passer'), ('like','J''aime'), ('super_like','Coup de cœur')
on conflict (code) do nothing;

insert into public.interests (code, display_name, category, display_order) values
  ('afrobeats','Afrobeats','music',1),
  ('coupe_decale','Coupé-décalé','music',2),
  ('rumba','Rumba','music',3),
  ('rap','Rap','music',4),
  ('rnb','R&B','music',5),
  ('jazz','Jazz','music',6),
  ('gospel','Gospel','music',7),
  ('dance','Danse','music',8),
  ('karaoke','Karaoké','music',9),
  ('cooking','Cuisine','food',10),
  ('foodie','Bonne bouffe','food',11),
  ('restaurants','Restos','food',12),
  ('cafe','Café','food',13),
  ('patisserie','Pâtisserie','food',14),
  ('football','Football','sport',15),
  ('fitness','Fitness','sport',16),
  ('running','Course à pied','sport',17),
  ('basketball','Basket','sport',18),
  ('yoga','Yoga','sport',19),
  ('swimming','Natation','sport',20),
  ('boxing','Boxe','sport',21),
  ('cycling','Vélo','sport',22),
  ('cinema','Cinéma','screen',23),
  ('series','Séries','screen',24),
  ('anime','Anime & manga','screen',25),
  ('gaming','Jeux vidéo','screen',26),
  ('reading','Lecture','arts',27),
  ('photography','Photographie','arts',28),
  ('art','Art & dessin','arts',29),
  ('writing','Écriture','arts',30),
  ('music_making','Faire de la musique','arts',31),
  ('sortir','Sorties','nightlife',32),
  ('concerts','Concerts','nightlife',33),
  ('festivals','Festivals','nightlife',34),
  ('travel','Voyages','travel',35),
  ('roadtrip','Road trips','travel',36),
  ('plage','Plage & soleil','travel',37),
  ('nature','Nature','nature',38),
  ('hiking','Randonnée','nature',39),
  ('animals','Animaux','nature',40),
  ('meditation','Méditation','wellness',41),
  ('wellness','Bien-être','wellness',42),
  ('entrepreneurship','Entrepreneuriat','knowledge',43),
  ('tech','Tech','knowledge',44),
  ('science','Science','knowledge',45),
  ('langues','Langues','knowledge',46),
  ('histoire','Histoire','knowledge',47),
  ('mode','Mode & style','style',48),
  ('beaute','Beauté','style',49),
  ('faith','Foi','faith',50),
  ('family','Famille','family',51)
on conflict (code) do update set
  display_name  = excluded.display_name,
  category      = excluded.category,
  display_order = excluded.display_order;

insert into public.prompts (code, question, display_order) values
  ('perfect_sunday','Un dimanche parfait ressemble à…',1),
  ('move_for_love','Je suis prêt·e à traverser une frontière pour…',2),
  ('green_flag','Chez l''autre, ce qui me fait fondre…',3),
  ('first_date','Notre premier rendez-vous, je l''imagine…',4)
on conflict (code) do nothing;

-- Motifs v2 (migration 024, Centre de sécurité) : les codes historiques restent
-- valides (FK des anciens dossiers), leurs libellés sont réalignés ; `do update`
-- pour que libellés et ordre suivent ce fichier, source de vérité.
insert into public.report_reasons (code, display_name, display_order) values
  ('scam','Demande d''argent ou arnaque',1),
  ('fake','Faux profil ou usurpation',2),
  ('harassment','Harcèlement ou insistance',3),
  ('threats','Menaces ou violence',4),
  ('inappropriate','Contenu sexuel non sollicité',5),
  ('hate','Propos haineux',6),
  ('offline_behavior','Une rencontre en personne',7),
  ('underage','Personne mineure',8),
  ('other','Autre chose',9)
on conflict (code) do update
  set display_name = excluded.display_name, display_order = excluded.display_order;

insert into public.lifestyle_options (kind, code, display_name, display_order) values
  ('astro','aries','Bélier',1),('astro','taurus','Taureau',2),('astro','gemini','Gémeaux',3),
  ('astro','cancer','Cancer',4),('astro','leo','Lion',5),('astro','virgo','Vierge',6),
  ('astro','libra','Balance',7),('astro','scorpio','Scorpion',8),('astro','sagittarius','Sagittaire',9),
  ('astro','capricorn','Capricorne',10),('astro','aquarius','Verseau',11),('astro','pisces','Poissons',12),
  ('education','high_school','Lycée',1),('education','student','En études',2),('education','bachelor','Licence',3),
  ('education','master','Master',4),('education','phd','Doctorat',5),('education','vocational','École pro',6),
  ('family','want','J''en veux',1),('family','dont_want','Je n''en veux pas',2),('family','have','J''en ai déjà',3),
  ('family','someday','Un jour, peut-être',4),('family','unsure','Je ne sais pas encore',5),
  ('smoking','no','Non-fumeur·se',1),('smoking','social','Fumeur·se social·e',2),
  ('smoking','yes','Régulièrement',3),('smoking','quitting','J''essaie d''arrêter',4),
  ('drinking','never','Jamais',1),('drinking','social','Socialement',2),('drinking','often','Régulièrement',3),
  ('sport','daily','Tous les jours',1),('sport','often','Souvent',2),('sport','sometimes','Parfois',3),('sport','never','Jamais',4),
  ('pets','dog','Chien',1),('pets','cat','Chat',2),('pets','both','Les deux',3),('pets','other','Autre',4),('pets','none','Aucun',5),
  ('communication','texting','Textos toute la journée',1),('communication','calls','Plutôt les appels',2),
  ('communication','in_person','J''aime voir en vrai',3),('communication','effort','Je fais des efforts',4),
  ('love_language','touch','Contact physique',1),('love_language','quality_time','Moments de qualité',2),
  ('love_language','gifts','Petits cadeaux',3),('love_language','acts','Services rendus',4),('love_language','words','Mots valorisants',5),
  ('religion','christianity','Christianisme',1),('religion','islam','Islam',2),('religion','spiritual','Spiritualité',3),
  ('religion','none','Sans religion',4),('religion','judaism','Judaïsme',5),('religion','buddhism','Bouddhisme',6),
  ('religion','hinduism','Hindouisme',7),('religion','other','Autre',8),
  ('living','alone','Seul·e',1),('living','roommates','En colocation',2),('living','with_family','En famille',3),
  ('living','with_kids','Avec mes enfants',4),('living','with_partner','En couple',5)
on conflict (kind, code) do nothing;

-- Catalogue 3 paliers (doctrine des offres §2). Identifiants store IMMUABLES :
-- les 'gold_*' gardent leurs com.mbenguiste.or.* d'origine (invariant n°3).
insert into public.subscription_plans (code, store_product_id, display_name, tier, period, months, price_eur, display_order) values
  ('plus_1w',     'com.mbenguiste.plus.1w',      'Plus — 1 semaine',      'plus',     'week',   0,  3.99, 10),
  ('plus_1m',     'com.mbenguiste.plus.1m',      'Plus — 1 mois',         'plus',     'month',  1,  8.99, 11),
  ('plus_3m',     'com.mbenguiste.plus.3m',      'Plus — 3 mois',         'plus',     'month',  3, 17.99, 12),
  ('or_1w',       'com.mbenguiste.or.1w',        'Or — 1 semaine',        'or',       'week',   0,  5.99, 20),
  ('gold_1m',     'com.mbenguiste.or.1m',        'Or — 1 mois',           'or',       'month',  1, 11.99, 21),
  ('gold_6m',     'com.mbenguiste.or.6m',        'Or — 6 mois',           'or',       'month',  6, 41.99, 22),
  ('gold_12m',    'com.mbenguiste.or.12m',       'Or — 12 mois',          'or',       'month', 12, 59.99, 23),
  ('prestige_1m', 'com.mbenguiste.prestige.1m',  'Prestige — 1 mois',     'prestige', 'month',  1, 19.99, 30),
  ('prestige_3m', 'com.mbenguiste.prestige.3m',  'Prestige — 3 mois',     'prestige', 'month',  3, 44.99, 31),
  ('prestige_6m', 'com.mbenguiste.prestige.6m',  'Prestige — 6 mois',     'prestige', 'month',  6, 74.99, 32)
on conflict (code) do update set
  store_product_id = excluded.store_product_id,
  display_name     = excluded.display_name,
  tier             = excluded.tier,
  period           = excluded.period,
  months           = excluded.months,
  price_eur        = excluded.price_eur,
  display_order    = excluded.display_order;

-- =============================================================================
--  9. MONÉTISATION  (consommables, crédits, quotas — cf. migration 009)
-- =============================================================================

create table if not exists public.consumable_products (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- 'superlike_5' | 'boost_1' ...
  store_product_id  text not null,                 -- 'com.mbenguiste.superlike.5'
  kind              text not null,                 -- 'superlike' | 'boost'
  quantity          smallint not null,             -- crédits accordés à l'achat
  price_eur         numeric(6,2) not null,
  display_order     smallint not null default 0
);

alter table public.profiles
  add column if not exists boost_active_until timestamptz;

create table if not exists public.user_credits (
  profile_id         uuid primary key references public.profiles(id) on delete cascade,
  superlike_balance  integer not null default 0,
  boost_balance      integer not null default 0,
  joker_balance      integer not null default 0,
  updated_at         timestamptz not null default now()
);
-- Bases antérieures à l'ajout du Joker (migration 016) : colonne rétro-ajoutée.
alter table public.user_credits
  add column if not exists joker_balance integer not null default 0;

create table if not exists public.usage_counters (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null,                 -- 'like' | 'superlike' | 'translation' | 'picks_like'
  used          integer not null default 0,
  window_start  timestamptz not null default now(),
  primary key (profile_id, kind)
);

create table if not exists public.consumable_purchases (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  product_id            uuid not null references public.consumable_products(id),
  store_transaction_id  text unique,
  quantity              smallint not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_consumable_purchases_profile on public.consumable_purchases(profile_id);

alter table public.user_credits          enable row level security;
alter table public.usage_counters        enable row level security;
alter table public.consumable_purchases  enable row level security;

drop policy if exists user_credits_read_own on public.user_credits;
create policy user_credits_read_own on public.user_credits
  for select to authenticated using (profile_id = auth.uid());
drop policy if exists usage_counters_read_own on public.usage_counters;
create policy usage_counters_read_own on public.usage_counters
  for select to authenticated using (profile_id = auth.uid());
drop policy if exists consumable_purchases_read_own on public.consumable_purchases;
create policy consumable_purchases_read_own on public.consumable_purchases
  for select to authenticated using (profile_id = auth.uid());

insert into public.consumable_products (code, store_product_id, kind, quantity, price_eur, display_order) values
  ('superlike_5',  'com.mbenguiste.superlike.5',  'superlike',  5,  4.99,  1),
  ('superlike_15', 'com.mbenguiste.superlike.15', 'superlike', 15, 11.99,  2),
  ('superlike_30', 'com.mbenguiste.superlike.30', 'superlike', 30, 19.99,  3),
  ('boost_1',      'com.mbenguiste.boost.1',      'boost',      1,  3.99, 11),
  ('boost_5',      'com.mbenguiste.boost.5',      'boost',      5, 14.99, 12),
  ('boost_10',     'com.mbenguiste.boost.10',     'boost',     10, 24.99, 13),
  ('joker_1',      'com.mbenguiste.joker.1',      'joker',      1,  2.99, 21),
  ('joker_3',      'com.mbenguiste.joker.3',      'joker',      3,  6.99, 22)
on conflict (code) do update set
  store_product_id = excluded.store_product_id,
  kind             = excluded.kind,
  quantity         = excluded.quantity,
  price_eur        = excluded.price_eur,
  display_order    = excluded.display_order;

-- Paliers de vente (doctrine 15/07) : premium_tier borne les 3 offres. null =
-- pas d'abonnement. is_premium reste le cache booléen des anciens gardes.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_premium_tier_chk') then
    alter table public.profiles add constraint profiles_premium_tier_chk
      check (premium_tier is null or premium_tier in ('plus', 'or', 'prestige'));
  end if;
end $$;

-- Registre des grants récurrents (5 Super Likes/sem Or, 1 Boost/mois Or, 1
-- Joker/sem Prestige). La PK (profil × kind × période) EST l'idempotence :
-- claim() = `insert … on conflict do nothing`, un seul versement par période.
create table if not exists public.recurring_grants (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,                 -- 'superlike' | 'boost' | 'joker'
  period_key   text not null,                 -- '2026-W29' (semaine ISO) | '2026-07' (mois)
  granted_at   timestamptz not null default now(),
  primary key (profile_id, kind, period_key)
);

alter table public.recurring_grants enable row level security;
-- Chacun LIT ses grants ; personne ne s'en INSÈRE (versement backend service_role only).
drop policy if exists recurring_grants_read_own on public.recurring_grants;
create policy recurring_grants_read_own on public.recurring_grants
  for select to authenticated using (profile_id = auth.uid());

-- =============================================================================
--  10. GÉOLOCALISATION  (recherche par pays + rayon — cf. migration 010)
-- =============================================================================

alter table public.profiles
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision;

alter table public.match_preferences
  add column if not exists search_country   text,
  add column if not exists search_radius_km integer;

-- =============================================================================
--  11. TÉLÉMÉTRIE DECK & ENGAGEMENT  (sondes UI — cf. migration 018)
-- =============================================================================
-- Trois étages : deck_events (bruts, append-only, réservoir V2),
-- profile_engagement (agrégats par profil que le RANKING lit),
-- deck_impressions (rotation par paire viewer→target). Ingestion par RPC
-- atomique idempotent (viewer, client_ref) ; likes/passes reçus par trigger
-- sur swipes (seule source de vérité du taux de like). RLS : tout FERMÉ au
-- client — écriture API service_role, lecture ranking backend only.

create table if not exists public.deck_events (
  id          bigint generated always as identity primary key,
  viewer_id   uuid not null references public.profiles(id) on delete cascade,
  target_id   uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in
                ('card_impression', 'profile_open', 'profile_section_view', 'profile_photo_view')),
  -- 30 min max : au-delà c'est une app oubliée ouverte, pas de l'attention.
  dwell_ms    integer check (dwell_ms is null or (dwell_ms >= 0 and dwell_ms <= 1800000)),
  payload     jsonb not null default '{}'::jsonb,
  client_ref  text not null,                 -- idempotence des retries de batch
  created_at  timestamptz not null default now(),
  constraint deck_events_no_self_chk check (viewer_id <> target_id)
);

create unique index if not exists uq_deck_events_viewer_client_ref
  on public.deck_events (viewer_id, client_ref);
create index if not exists idx_deck_events_target_kind
  on public.deck_events (target_id, kind);

create table if not exists public.profile_engagement (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  impressions     integer not null default 0,   -- card_impression reçues
  dwell_ms_total  bigint  not null default 0,   -- attention cumulée sur sa carte
  profile_opens   integer not null default 0,   -- ouvertures du profil détaillé
  likes_received  integer not null default 0,   -- trigger swipes (like + super_like)
  passes_received integer not null default 0,   -- trigger swipes (dénominateur du taux)
  updated_at      timestamptz not null default now()
);

create table if not exists public.deck_impressions (
  viewer_id    uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  seen_count   integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (viewer_id, target_id)
);

-- Ingestion atomique : events = [{targetId, kind, dwellMs?, payload?, clientRef}],
-- renvoie le nombre de NOUVEAUX (doublon client_ref = ignoré sans re-compter).
create or replace function public.ingest_deck_events(p_viewer uuid, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted integer := 0;
  e jsonb;
begin
  for e in select * from jsonb_array_elements(p_events) loop
    begin
      insert into public.deck_events (viewer_id, target_id, kind, dwell_ms, payload, client_ref)
      values (
        p_viewer,
        (e->>'targetId')::uuid,
        e->>'kind',
        nullif(e->>'dwellMs', '')::integer,
        coalesce(e->'payload', '{}'::jsonb),
        e->>'clientRef'
      );
    exception when unique_violation then
      continue;  -- déjà ingéré (retry réseau) : idempotent, on passe au suivant
    end;
    accepted := accepted + 1;

    if e->>'kind' = 'card_impression' then
      insert into public.profile_engagement as pe (profile_id, impressions, dwell_ms_total)
      values ((e->>'targetId')::uuid, 1, coalesce(nullif(e->>'dwellMs', '')::bigint, 0))
      on conflict (profile_id) do update set
        impressions    = pe.impressions + 1,
        dwell_ms_total = pe.dwell_ms_total + coalesce(nullif(e->>'dwellMs', '')::bigint, 0),
        updated_at     = now();
      insert into public.deck_impressions as di (viewer_id, target_id, seen_count)
      values (p_viewer, (e->>'targetId')::uuid, 1)
      on conflict (viewer_id, target_id) do update set
        seen_count   = di.seen_count + 1,
        last_seen_at = now();
    elsif e->>'kind' = 'profile_open' then
      insert into public.profile_engagement as pe (profile_id, profile_opens)
      values ((e->>'targetId')::uuid, 1)
      on conflict (profile_id) do update set
        profile_opens = pe.profile_opens + 1,
        updated_at    = now();
    end if;
    -- section_view / photo_view : bruts seulement (réservoir V2), rien à agréger.
  end loop;
  return accepted;
end $$;

-- Likes/passes reçus : swipes est la seule source de vérité du taux de like
-- (deck, picks, likes ciblés) — précédent maison : trigger mutual-like → match.
create or replace function public.bump_engagement_on_swipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  select code into v_code from public.swipe_actions where id = new.action_id;
  insert into public.profile_engagement as pe (profile_id, likes_received, passes_received)
  values (
    new.target_id,
    case when v_code in ('like', 'super_like') then 1 else 0 end,
    case when v_code = 'pass' then 1 else 0 end
  )
  on conflict (profile_id) do update set
    likes_received  = pe.likes_received  + excluded.likes_received,
    passes_received = pe.passes_received + excluded.passes_received,
    updated_at      = now();
  return new;
end $$;

drop trigger if exists trg_swipes_engagement on public.swipes;
create trigger trg_swipes_engagement
  after insert on public.swipes
  for each row execute function public.bump_engagement_on_swipe();

alter table public.deck_events        enable row level security;
alter table public.profile_engagement enable row level security;
alter table public.deck_impressions   enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).

-- =============================================================================
--  12. RÉGLAGES À CHAUD  (calibrage matching/ranking — cf. migration 019)
-- =============================================================================
-- app_settings (clé → valeur jsonb) : curseur liquidité↔rareté + poids du
-- ranking, changés par UPDATE SQL (effet ~60 s via cache backend), sans
-- redéploiement ni MAJ appli. Cascade : app_settings → défaut domaine → clamp.
-- RLS : FERMÉ au client (lecture + écriture backend service_role only).

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('deck.admirer_ratio',         '0.5'::jsonb),
  ('deck.admirer_cap',           '6'::jsonb),
  ('ranking.reciprocity_weight', '15'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).

-- =============================================================================
--  13. PENDING_LIKES  (agrégat temps réel des likes reçus — cf. migration 020)
-- =============================================================================
-- Maintenu par triggers (comme le match mutuel) : l'onglet « Likes » lit
-- `where target_id` (index) au lieu de charger tous mes swipes pour un NOT IN.
-- Temps réel, pas de fantômes. RLS fermé au client.

create table if not exists public.pending_likes (
  target_id    uuid not null references public.profiles(id) on delete cascade,
  swiper_id    uuid not null references public.profiles(id) on delete cascade,
  action_code  text not null,                 -- 'like' | 'super_like'
  created_at   timestamptz not null default now(),
  primary key (target_id, swiper_id)
);

create or replace function public.sync_pending_likes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  select code into v_code from public.swipe_actions where id = new.action_id;

  -- 1. Le swipe S→T est une RÉPONSE au like éventuel de T→S : T quitte les pending de S.
  delete from public.pending_likes
   where target_id = new.swiper_id and swiper_id = new.target_id;

  -- 2. Le swipe S→T définit si S est un like EN ATTENTE pour T (état = dernier swipe).
  if v_code in ('like', 'super_like')
     and not exists (
       select 1 from public.swipes s
       where s.swiper_id = new.target_id and s.target_id = new.swiper_id
     ) then
    insert into public.pending_likes (target_id, swiper_id, action_code, created_at)
    values (new.target_id, new.swiper_id, v_code, new.created_at)
    on conflict (target_id, swiper_id)
      do update set action_code = excluded.action_code, created_at = excluded.created_at;
  else
    -- pass (ou T a déjà répondu) → S n'est PAS/PLUS un like en attente pour T.
    -- Indispensable au trigger OR UPDATE : un like→pass en UPSERT retire le
    -- « like fantôme », sinon S resterait dans les Likes de T après l'avoir passé.
    delete from public.pending_likes
     where target_id = new.target_id and swiper_id = new.swiper_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_pending_likes on public.swipes;
-- INSERT OR UPDATE : swipes est un upsert (record) → un changement d'avis sur une
-- paire déjà swipée est un UPDATE, qui doit resynchroniser pending_likes.
create trigger trg_sync_pending_likes
  after insert or update on public.swipes
  for each row execute function public.sync_pending_likes();

create or replace function public.purge_pending_on_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.pending_likes
   where (target_id = new.blocker_id and swiper_id = new.blocked_id)
      or (target_id = new.blocked_id and swiper_id = new.blocker_id);
  return new;
end $$;

drop trigger if exists trg_purge_pending_on_block on public.blocks;
create trigger trg_purge_pending_on_block
  after insert on public.blocks
  for each row execute function public.purge_pending_on_block();

alter table public.pending_likes enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).

-- =============================================================================
--  14. EMBEDDINGS PHOTO  (similarité visuelle — cf. migration 021)
-- =============================================================================
-- Empreinte SigLIP 2 (768 dims, générée en LOCAL, pas de reconnaissance faciale)
-- par photo + signature visuelle du profil (moyenne pondérée, photo principale
-- double). Comparées au goût appris du viewer par cosinus (deck/picks/Mystère).

alter table public.profile_photos
  add column if not exists embedding halfvec(768);

-- Versions FLOUTÉES (contextes masqués). Deux variantes, deux usages (migr 011 + 027) :
--   • blur_url       — masque tuile (220×300, sigma 20), grille « qui t'a liké » ;
--   • blur_hero_url  — masque plein écran (720×1280, sigma calibré à l'œil), carte
--                      Mystère. Laisse passer plus de FORME sans rendre le VISAGE ;
--                      sur un bucket public → doit être sûr tout seul.
-- Nullable : best-effort à l'upload, le backfill rattrape (scripts/backfill-*).
alter table public.profile_photos
  add column if not exists blur_url text;

alter table public.profile_photos
  add column if not exists blur_hero_url text;

alter table public.profiles
  add column if not exists photo_vec halfvec(768);

create index if not exists idx_profiles_photo_vec_hnsw
  on public.profiles using hnsw (photo_vec halfvec_cosine_ops);

create index if not exists idx_profile_photos_embedding_hnsw
  on public.profile_photos using hnsw (embedding halfvec_cosine_ops);

-- =============================================================================
--  15. PROGRAMME PARTENAIRES  (codes influenceurs & commissions — cf. migr 028)
-- =============================================================================
-- L'influenceur (partner) partage un code ; un membre l'entre à l'inscription
-- (referrals — UNE attribution par membre, le 1er code gagne) ; chaque paiement
-- d'abonnement de ce membre inscrit une commission (commission_ledger : net après
-- part store × taux, idempotente par event_id RevenueCat). Versements MANUELS
-- (partner_payouts). RLS FERMÉ au client : le portail lit via l'API (service_role).

create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,  -- compte Supabase (null tant que l'invitation n'est pas acceptée)
  display_name  text not null,
  email         text not null unique,
  rate_bps      integer not null default 3000,   -- taux en points de base : 3000 = 30,00 %
  is_founder    boolean not null default false,  -- Cercle Fondateur (40 %)
  status        text not null default 'invited', -- 'invited' | 'active' | 'frozen'
  created_at    timestamptz not null default now(),
  activated_at  timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'partners_status_chk') then
    alter table public.partners add constraint partners_status_chk
      check (status in ('invited', 'active', 'frozen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partners_rate_chk') then
    alter table public.partners add constraint partners_rate_chk
      check (rate_bps between 0 and 10000);
  end if;
end $$;

-- Codes partagés. Le code (MAJUSCULES, normalisé côté API) EST la clé.
create table if not exists public.promo_codes (
  code        text primary key,
  partner_id  uuid not null references public.partners(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_promo_codes_partner on public.promo_codes(partner_id);

-- Attribution d'un membre à un code, à l'inscription. profile_id EN PK : UNE
-- seule attribution par membre (le 1er code gagne, jamais réécrit) — c'est la
-- garde anti-fraude (pas de ré-attribution).
create table if not exists public.referrals (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  code           text not null references public.promo_codes(code),
  partner_id     uuid not null references public.partners(id) on delete cascade,  -- dénormalisé (requêtes par partenaire)
  source         text not null default 'manual',  -- 'link' | 'manual' | 'deferred'
  attributed_at  timestamptz not null default now()
);
create index if not exists idx_referrals_partner on public.referrals(partner_id);

-- Versements manuels (au lancement : créer une ligne = « payé à la main »).
create table if not exists public.partner_payouts (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete cascade,
  amount_cents  integer not null,
  currency      text not null default 'EUR',
  method        text,                             -- 'mobile_money' | 'wise' | 'paypal' | libre
  reference     text,                             -- note libre (n° de transaction…)
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_partner_payouts_partner on public.partner_payouts(partner_id);

-- Registre des commissions : UNE ligne par événement d'abonnement commissionnable
-- (INITIAL_PURCHASE / RENEWAL). event_id (id RevenueCat) UNIQUE → idempotence du
-- rejeu webhook. Montants en centimes entiers (jamais de flottant). Statuts :
-- pending → validated (après hold J+30) → paid (rattaché à un payout) ; reversed
-- si remboursement.
create table if not exists public.commission_ledger (
  id                uuid primary key default gen_random_uuid(),
  partner_id        uuid not null references public.partners(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,   -- l'abonné référé
  event_id          text unique,                  -- id d'événement RevenueCat (idempotence)
  event_type        text not null,                -- 'INITIAL_PURCHASE' | 'RENEWAL'
  gross_cents       integer not null,             -- prix payé
  net_cents         integer not null,             -- après part store (price × takehome)
  rate_bps          integer not null,             -- taux figé au calcul
  commission_cents  integer not null,             -- net × taux
  currency          text not null default 'EUR',
  status            text not null default 'pending',
  hold_until        timestamptz not null,         -- attribution + 30 j (anti-fraude / remboursement)
  payout_id         uuid references public.partner_payouts(id) on delete set null,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'commission_status_chk') then
    alter table public.commission_ledger add constraint commission_status_chk
      check (status in ('pending', 'validated', 'paid', 'reversed'));
  end if;
end $$;
create index if not exists idx_commission_partner_status on public.commission_ledger(partner_id, status);
create index if not exists idx_commission_profile on public.commission_ledger(profile_id);

alter table public.partners           enable row level security;
alter table public.promo_codes        enable row level security;
alter table public.referrals          enable row level security;
alter table public.partner_payouts    enable row level security;
alter table public.commission_ledger  enable row level security;
-- Aucune policy : tout FERMÉ à authenticated/anon. Le portail partenaire lit via
-- l'API backend (service_role, qui bypass la RLS) après validation du jeton.

-- =============================================================================
--  14. MYSTÈRE & AVENTURE TEMPS RÉEL  (cf. migration 031)
-- =============================================================================
--  Appariement mutuel algorithmique (AUCUN like) + sessions d'aventure jouées
--  à deux en Realtime. Anonymat : aucune table lisible par le client ne porte
--  l'id du partenaire ; l'auteur d'une réponse est désigné par son RÔLE
--  ('a'=user_low, 'b'=user_high), et la correspondance rôle→id vit seulement
--  dans mystere_pairs (fermée). Voir la migration pour le détail commenté.

create table if not exists public.mystere_pairs (
  id          uuid primary key default gen_random_uuid(),
  user_low    uuid not null references public.profiles(id) on delete cascade,
  user_high   uuid not null references public.profiles(id) on delete cascade,
  state       text not null default 'proposed'
              check (state in ('proposed','active','won','lost','dissolved')),
  drawn_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_pair_order check (user_low < user_high),
  unique (user_low, user_high)
);
create index if not exists idx_mystere_pairs_low  on public.mystere_pairs(user_low)  where state in ('proposed','active');
create index if not exists idx_mystere_pairs_high on public.mystere_pairs(user_high) where state in ('proposed','active');

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

create or replace function public.mystere_role(p_pair uuid, p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p.user_low  = p_uid then 'a'
    when p.user_high = p_uid then 'b'
    else null
  end
  from public.mystere_pairs p where p.id = p_pair;
$$;

alter table public.mystere_pairs enable row level security;
-- Aucune policy : FERMÉE au client (backend service_role uniquement).

create table if not exists public.aventure_sessions (
  id            uuid primary key default gen_random_uuid(),
  pair_id       uuid not null references public.mystere_pairs(id) on delete cascade,
  graph_id      text not null,
  current_node  text not null,
  phase         text not null default 'scene',
  outcome       text check (outcome in ('match','echec','left')),
  joker_used    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (pair_id)
);
create index if not exists idx_aventure_sessions_pair on public.aventure_sessions(pair_id);

alter table public.aventure_sessions enable row level security;
drop policy if exists aventure_sessions_read on public.aventure_sessions;
create policy aventure_sessions_read on public.aventure_sessions
  for select to authenticated
  using (public.mystere_role(pair_id, auth.uid()) is not null);

create table if not exists public.aventure_answers (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.aventure_sessions(id) on delete cascade,
  node_id       text not null,
  role          text not null check (role in ('a','b')),
  answer_index  int,
  message_text  text,
  created_at    timestamptz not null default now(),
  unique (session_id, node_id, role)
);
create index if not exists idx_aventure_answers_session on public.aventure_answers(session_id);

alter table public.aventure_answers enable row level security;
drop policy if exists aventure_answers_read on public.aventure_answers;
create policy aventure_answers_read on public.aventure_answers
  for select to authenticated
  using (exists (
    select 1 from public.aventure_sessions s
    where s.id = aventure_answers.session_id
      and public.mystere_role(s.pair_id, auth.uid()) is not null
  ));
drop policy if exists aventure_answers_write on public.aventure_answers;
create policy aventure_answers_write on public.aventure_answers
  for insert to authenticated
  with check (role = public.mystere_role(
    (select s.pair_id from public.aventure_sessions s where s.id = aventure_answers.session_id),
    auth.uid()
  ));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.aventure_answers; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.aventure_sessions; exception when duplicate_object then null; end;
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('mystere.draw_hour_utc',      '21'::jsonb),
  ('mystere.window_minutes',     '120'::jsonb),
  ('mystere.pass_minutes',       '10'::jsonb),
  ('mystere.floor_in_window',    '10'::jsonb),
  ('mystere.floor_out_window',   '20'::jsonb),
  ('mystere.assortative_weight', '20'::jsonb)
on conflict (key) do nothing;

-- =============================================================================
--  Done. Backend connects with SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
-- =============================================================================
