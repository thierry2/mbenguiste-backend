-- =============================================================================
--  016 · Paliers de vente & grants récurrents  (doctrine des offres, 15/07/2026)
--
--  Le booléen is_premium ne suffit plus : on vend désormais 3 paliers
--  hiérarchiques (plus < or < prestige). premium_tier les borne ; is_premium
--  reste en cache dénormalisé pour la compat des anciens gardes.
--
--  Les avantages récurrents (5 Super Likes/sem Or, 1 Boost/mois Or, 1 Joker/sem
--  Prestige) sont versés PARESSEUSEMENT (pas de cron) : recurring_grants porte
--  l'idempotence par sa PK (profil × kind × période) — un seul versement/période.
--
--  Idempotente : rejouable sans effet de bord.
-- =============================================================================

-- ── Palier de vente sur profiles ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists premium_tier text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_premium_tier_chk') then
    alter table public.profiles add constraint profiles_premium_tier_chk
      check (premium_tier is null or premium_tier in ('plus', 'or', 'prestige'));
  end if;
end $$;

-- Backfill : les abonnés existants (is_premium sans tier) étaient l'ancien « Or ».
-- Un tier déjà posé n'est JAMAIS écrasé → rejouable.
update public.profiles
   set premium_tier = 'or'
 where is_premium = true and premium_tier is null;

-- ── Solde Joker sur user_credits ─────────────────────────────────────────────
alter table public.user_credits
  add column if not exists joker_balance integer not null default 0;

-- ── Registre des grants récurrents ───────────────────────────────────────────
create table if not exists public.recurring_grants (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,                 -- 'superlike' | 'boost' | 'joker'
  period_key   text not null,                 -- '2026-W29' (semaine ISO) | '2026-07' (mois)
  granted_at   timestamptz not null default now(),
  primary key (profile_id, kind, period_key)
);

alter table public.recurring_grants enable row level security;
drop policy if exists recurring_grants_read_own on public.recurring_grants;
create policy recurring_grants_read_own on public.recurring_grants
  for select to authenticated using (profile_id = auth.uid());

-- ── Consommables Joker au catalogue ──────────────────────────────────────────
insert into public.consumable_products (code, store_product_id, kind, quantity, price_eur, display_order) values
  ('joker_1', 'com.mbenguiste.joker.1', 'joker', 1, 2.99, 21),
  ('joker_3', 'com.mbenguiste.joker.3', 'joker', 3, 6.99, 22)
on conflict (code) do update set
  store_product_id = excluded.store_product_id,
  kind             = excluded.kind,
  quantity         = excluded.quantity,
  price_eur        = excluded.price_eur,
  display_order    = excluded.display_order;
