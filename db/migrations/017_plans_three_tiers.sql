-- =============================================================================
--  017 · Catalogue d'abonnements 3 paliers  (doctrine des offres §2, 15/07/2026)
--
--  Le paywall passe d'un unique « Or » à 3 paliers hiérarchiques Plus/Or/Prestige,
--  avec des formules hebdomadaires (achat d'impulsion) en plus des mensuelles.
--
--  Identifiants store IMMUABLES (invariant n°3) : les plans 'gold_*' existants
--  gardent leurs com.mbenguiste.or.* et deviennent simplement le palier 'or'.
--
--  Idempotente : rejouable sans effet de bord.
-- =============================================================================

alter table public.subscription_plans
  add column if not exists tier   text not null default 'or',
  add column if not exists period text not null default 'month';

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
