-- =============================================================================
--  Migration 012 — Descripteurs de profil manquants (vitrine « fiche complète »)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  La refonte du profil consulté range chaque info à UNE place. Six descripteurs
--  manquaient au schéma :
--    • taille, origine, métier      → colonnes directes sur profiles
--    • religion, logement           → nouveaux `kind` dans lifestyle_options
--  (morphologie volontairement écartée — jugée sans valeur pour ce public.)
-- =============================================================================

alter table public.profiles
  add column if not exists height_cm      smallint,   -- taille en cm (100–250)
  add column if not exists origin_country text,        -- pays d'ORIGINE (ISO alpha-2), distinct de current_country
  add column if not exists occupation     text;        -- métier / profession, texte libre

comment on column public.profiles.height_cm      is 'Taille en centimètres (affichée en carte d''identité du profil).';
comment on column public.profiles.origin_country is 'Pays d''origine (ISO alpha-2) — distinct de current_country (là où la personne vit).';
comment on column public.profiles.occupation     is 'Métier / profession, texte libre.';

-- Religion & logement rejoignent le modèle léger `lifestyle` (JSONB {kind: code}).
insert into public.lifestyle_options (kind, code, display_name, display_order) values
  ('religion','christianity','Christianisme',1),('religion','islam','Islam',2),
  ('religion','spiritual','Spiritualité',3),('religion','none','Sans religion',4),
  ('religion','judaism','Judaïsme',5),('religion','buddhism','Bouddhisme',6),
  ('religion','hinduism','Hindouisme',7),('religion','other','Autre',8),

  ('living','alone','Seul·e',1),('living','roommates','En colocation',2),
  ('living','with_family','En famille',3),('living','with_kids','Avec mes enfants',4),
  ('living','with_partner','En couple',5)
on conflict (kind, code) do nothing;
