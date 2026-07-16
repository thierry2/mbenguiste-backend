-- =============================================================================
--  018 · Télémétrie deck & agrégats d'engagement  (sondes UI, 16/07/2026)
--
--  Trois étages :
--   - deck_events : les événements BRUTS des sondes (dwell par carte, photos
--     vues, ouvertures de profil, sections lues), append-only. Jamais lus en
--     ligne par le ranking — réservoir de la personnalisation V2. Purge
--     périodique (> 90 j) à poser côté Supabase quand le volume l'exigera.
--   - profile_engagement : les agrégats PAR PROFIL (« engagement reçu ») que le
--     ranking lit — une ligne par profil, upsert incrémental à l'ingestion,
--     likes/passes reçus maintenus par trigger sur swipes (source de vérité
--     unique : elle couvre deck + picks + likes ciblés).
--   - deck_impressions : la rotation PAR PAIRE (viewer, target) — « déjà montré
--     N fois sans swipe » → la pénalité de ré-exposition du ranking.
--
--  L'ingestion est un RPC ATOMIQUE, idempotent par (viewer, client_ref) : un
--  retry réseau du même batch ne double jamais un compteur.
--
--  RLS : tout est FERMÉ au client (aucune policy) — écriture par l'API en
--  service_role, lecture par le ranking backend. L'engagement d'un profil ne
--  regarde personne, pas même lui (pas de reverse-engineering du deck).
--
--  Idempotente : rejouable sans effet de bord.
-- =============================================================================

-- ── Événements bruts ─────────────────────────────────────────────────────────
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

-- ── Agrégats par profil (ce que le ranking lit) ──────────────────────────────
create table if not exists public.profile_engagement (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  impressions     integer not null default 0,   -- card_impression reçues
  dwell_ms_total  bigint  not null default 0,   -- attention cumulée sur sa carte
  profile_opens   integer not null default 0,   -- ouvertures du profil détaillé
  likes_received  integer not null default 0,   -- trigger swipes (like + super_like)
  passes_received integer not null default 0,   -- trigger swipes (dénominateur du taux)
  updated_at      timestamptz not null default now()
);

-- ── Rotation par paire (viewer, target) ──────────────────────────────────────
create table if not exists public.deck_impressions (
  viewer_id    uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  seen_count   integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (viewer_id, target_id)
);

-- ── Ingestion atomique (dédoublonnage + agrégats dans la même transaction) ───
-- events = [{targetId, kind, dwellMs?, payload?, clientRef}] ; renvoie le nombre
-- d'événements NOUVEAUX (un doublon client_ref est ignoré SANS re-compter).
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

-- ── Likes/passes reçus : trigger sur swipes ──────────────────────────────────
-- La table swipes est la SEULE source de vérité du taux de like (deck, picks,
-- likes ciblés, likes-back) — précédent maison : trigger mutual-like → match.
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

-- ── RLS : tout fermé au client ───────────────────────────────────────────────
alter table public.deck_events        enable row level security;
alter table public.profile_engagement enable row level security;
alter table public.deck_impressions   enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).
