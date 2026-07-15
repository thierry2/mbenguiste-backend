-- =============================================================================
--  Migration 009 — Monétisation : consommables, crédits, quotas
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Socle des paiements (les abonnements existaient déjà : subscription_plans,
--  subscriptions, profiles.is_premium / premium_until). Cette migration ajoute :
--    • les identifiants produits store + prix .99 sur les abonnements ;
--    • le catalogue des CONSOMMABLES (Coups de cœur, Boosts) ;
--    • les CRÉDITS de l'utilisateur (soldes super-likes / boosts) ;
--    • les COMPTEURS de quotas gratuits (likes, super-likes, traduction) ;
--    • le REGISTRE d'achats (idempotence via l'id de transaction store) ;
--    • profiles.boost_active_until (mise en avant en découverte).
--
--  Écritures via le backend (service_role). Le client ne peut que LIRE ses
--  propres crédits / compteurs — il ne peut jamais se créditer lui-même.
-- =============================================================================

-- ── Abonnements : identifiant store + prix .99 ───────────────────────────────
alter table public.subscription_plans
  add column if not exists store_product_id text;

update public.subscription_plans set price_eur = 11.99, store_product_id = 'com.mbenguiste.or.1m'  where code = 'gold_1m';
update public.subscription_plans set price_eur = 41.99, store_product_id = 'com.mbenguiste.or.6m'  where code = 'gold_6m';
update public.subscription_plans set price_eur = 59.99, store_product_id = 'com.mbenguiste.or.12m' where code = 'gold_12m';

-- ── Catalogue des consommables (one-shot) ────────────────────────────────────
create table if not exists public.consumable_products (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- 'superlike_5' | 'boost_1' ...
  store_product_id  text not null,                 -- 'com.mbenguiste.superlike.5'
  kind              text not null,                 -- 'superlike' | 'boost'
  quantity          smallint not null,             -- crédits accordés à l'achat
  price_eur         numeric(6,2) not null,
  display_order     smallint not null default 0
);

insert into public.consumable_products (code, store_product_id, kind, quantity, price_eur, display_order) values
  ('superlike_5',  'com.mbenguiste.superlike.5',  'superlike',  5,  4.99,  1),
  ('superlike_15', 'com.mbenguiste.superlike.15', 'superlike', 15, 11.99,  2),
  ('superlike_30', 'com.mbenguiste.superlike.30', 'superlike', 30, 19.99,  3),
  ('boost_1',      'com.mbenguiste.boost.1',      'boost',      1,  3.99, 11),
  ('boost_5',      'com.mbenguiste.boost.5',      'boost',      5, 14.99, 12),
  ('boost_10',     'com.mbenguiste.boost.10',     'boost',     10, 24.99, 13)
on conflict (code) do nothing;

-- ── Mise en avant « Boost » (rang en découverte pendant ~30 min) ─────────────
alter table public.profiles
  add column if not exists boost_active_until timestamptz;

-- ── Crédits consommables de l'utilisateur (soldes) ───────────────────────────
create table if not exists public.user_credits (
  profile_id         uuid primary key references public.profiles(id) on delete cascade,
  superlike_balance  integer not null default 0,
  boost_balance      integer not null default 0,
  updated_at         timestamptz not null default now()
);

-- ── Compteurs de quotas gratuits (une ligne par utilisateur × ressource) ─────
-- La longueur de fenêtre est décidée côté backend (like 12 h, superlike 24 h,
-- traduction 24 h) : quand `now() - window_start` dépasse la fenêtre, le backend
-- remet `used = 0` et `window_start = now()`.
create table if not exists public.usage_counters (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null,                 -- 'like' | 'superlike' | 'translation'
  used          integer not null default 0,
  window_start  timestamptz not null default now(),
  primary key (profile_id, kind)
);

-- ── Registre d'achats de consommables (idempotence webhook/reçu) ─────────────
create table if not exists public.consumable_purchases (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  product_id            uuid not null references public.consumable_products(id),
  store_transaction_id  text unique,           -- rejoue sans double-créditer
  quantity              smallint not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_consumable_purchases_profile on public.consumable_purchases(profile_id);

-- ── RLS : l'utilisateur LIT ses propres lignes, jamais n'écrit (backend only) ─
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
