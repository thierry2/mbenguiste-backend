-- =============================================================================
--  015 · Filtres de préférences v2
--
--  Doctrine : TOUT ce qu'on peut renseigner sur son profil doit pouvoir servir de
--  filtre à la découverte. Il manquait l'origine, la taille, les intérêts et les
--  descripteurs de mode de vie (tabac, alcool, religion, projets familiaux…).
--
--  `lifestyle_filters` est un objet {kind: [codes]} — miroir de `profiles.lifestyle`
--  ({kind: code}) : plusieurs valeurs acceptées par catégorie (« non-fumeur OU
--  j'essaie d'arrêter »). Vide = pas de filtre sur cette catégorie.
-- =============================================================================

alter table public.match_preferences
  add column if not exists origin_country          text,                        -- ISO alpha-2, null = toutes origines
  add column if not exists min_height              smallint,                    -- cm, null = pas de plancher
  add column if not exists max_height              smallint,                    -- cm, null = pas de plafond
  add column if not exists require_shared_interest boolean not null default false,
  add column if not exists lifestyle_filters       jsonb   not null default '{}'::jsonb;

comment on column public.match_preferences.origin_country is
  'Origine recherchée (ISO alpha-2). Distinct de search_country, qui est le pays de RÉSIDENCE.';
comment on column public.match_preferences.lifestyle_filters is
  'Descripteurs acceptés : {kind: [code, ...]}. Vide = indifférent.';

-- Le filtre sur l''origine et la taille interroge des colonnes de `profiles` :
-- des index partiels gardent la découverte rapide quand ces filtres sont posés.
create index if not exists profiles_origin_country_idx on public.profiles (origin_country)
  where origin_country is not null;
create index if not exists profiles_height_idx on public.profiles (height_cm)
  where height_cm is not null;
