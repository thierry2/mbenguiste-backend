-- =============================================================================
--  Migration 007 — Descripteurs « mode de vie » (lifestyle)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Modèle léger : UNE table de référence groupée par `kind` (astro, études…) +
--  UNE colonne JSONB `lifestyle` sur profiles ({kind: code}). Chaque descripteur
--  est un choix unique. Filtrable en premium via l'opérateur JSONB.
-- =============================================================================

create table if not exists public.lifestyle_options (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,      -- 'astro','education','family','smoking','drinking','sport','pets','communication','love_language'
  code          text not null,
  display_name  text not null,
  display_order smallint not null default 0,
  unique (kind, code)
);

alter table public.profiles
  add column if not exists lifestyle jsonb not null default '{}'::jsonb;

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
  ('love_language','gifts','Petits cadeaux',3),('love_language','acts','Services rendus',4),('love_language','words','Mots valorisants',5)
on conflict (kind, code) do nothing;
