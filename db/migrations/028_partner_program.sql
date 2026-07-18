-- =============================================================================
--  028 · Programme Partenaires  (codes influenceurs & commissions, 18/07/2026)
--
--  L'influenceur (partner) partage un code ; un membre l'entre à l'inscription
--  (referrals — UNE attribution par membre, le 1er code gagne, garde anti-fraude) ;
--  chaque paiement d'abonnement de ce membre inscrit une commission
--  (commission_ledger : net après part store × taux, idempotente par event_id
--  RevenueCat). Versements MANUELS au lancement (partner_payouts).
--
--  RLS FERMÉ au client : le portail partenaire lit via l'API backend
--  (service_role, qui bypass la RLS) après validation du jeton Supabase.
--
--  Idempotente : rejouable sans effet de bord.
-- =============================================================================

-- ── Le partenaire (influenceur) ──────────────────────────────────────────────
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

-- ── Codes partagés (le code MAJUSCULES EST la clé) ───────────────────────────
create table if not exists public.promo_codes (
  code        text primary key,
  partner_id  uuid not null references public.partners(id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_promo_codes_partner on public.promo_codes(partner_id);

-- ── Attribution d'un membre à un code, à l'inscription ───────────────────────
-- profile_id EN PK : UNE seule attribution par membre (le 1er code gagne, jamais
-- réécrit) — garde anti-fraude (pas de ré-attribution).
create table if not exists public.referrals (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  code           text not null references public.promo_codes(code),
  partner_id     uuid not null references public.partners(id) on delete cascade,  -- dénormalisé (requêtes par partenaire)
  source         text not null default 'manual',  -- 'link' | 'manual' | 'deferred'
  attributed_at  timestamptz not null default now()
);
create index if not exists idx_referrals_partner on public.referrals(partner_id);

-- ── Versements manuels (créer une ligne = « payé à la main ») ────────────────
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

-- ── Registre des commissions ─────────────────────────────────────────────────
-- UNE ligne par événement d'abonnement commissionnable (INITIAL_PURCHASE /
-- RENEWAL). event_id (id RevenueCat) UNIQUE → idempotence du rejeu webhook.
-- Centimes entiers (jamais de flottant). pending → validated (après hold J+30) →
-- paid (rattaché à un payout) ; reversed si remboursement.
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

-- ── RLS : tout FERMÉ au client ───────────────────────────────────────────────
alter table public.partners           enable row level security;
alter table public.promo_codes        enable row level security;
alter table public.referrals          enable row level security;
alter table public.partner_payouts    enable row level security;
alter table public.commission_ledger  enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon. Le portail
-- partenaire lit via l'API backend (service_role) après validation du jeton.
