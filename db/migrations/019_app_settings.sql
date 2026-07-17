-- =============================================================================
--  019 · Réglages à chaud  (calibrage matching/ranking sans redéploiement, 17/07)
--
--  app_settings (clé → valeur jsonb) : le curseur LIQUIDITÉ ↔ RARETÉ et les
--  poids du ranking se changent par un simple UPDATE SQL — effet en ~60 s
--  (cache backend), SANS redéployer Railway ni mettre à jour l'appli.
--
--  Cascade de sécurité côté backend : app_settings → défaut du domaine → clamp.
--  Une valeur absente ou aberrante NE casse jamais le deck.
--
--  RLS : FERMÉ au client (lecture ET écriture backend service_role only) — un
--  réglage global n'est ni lisible ni forçable depuis l'appli.
--
--  Idempotente : rejouable sans effet de bord (les valeurs déjà posées ne sont
--  pas réécrites → on ne perd pas un calibrage fait à la main).
-- =============================================================================

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Défauts de lancement (hybride généreux : liquidité d'abord — cf. décision 17/07).
--  deck.admirer_ratio        : part des likes ORDINAIRES reçus injectés au deck
--                              (0 = rareté pure → onglet Likes only ; 1 = tous).
--  deck.admirer_cap          : max d'admirateurs ordinaires par fournée.
--  ranking.reciprocity_weight: bonus de score « m'a likée » (0 = pas de bonus de tête).
insert into public.app_settings (key, value) values
  ('deck.admirer_ratio',         '0.5'::jsonb),
  ('deck.admirer_cap',           '6'::jsonb),
  ('ranking.reciprocity_weight', '15'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
-- Aucune policy : invisible et inécrivable pour authenticated/anon (voulu).
