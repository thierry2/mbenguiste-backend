-- =============================================================================
--  Migration 010 — Géolocalisation : recherche par PAYS + RAYON (km)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  La recherche géographique devient un CHOIX de l'utilisateur (plus de
--  cross-border imposé) : un pays cible (mono) + un rayon optionnel. La distance
--  est calculée en JS (haversine) à partir de current_lat/current_lng — pas de
--  requête PostGIS (plus simple, même patron que le post-filtre photos).
--
--  Le rayon s'applique AUTOUR DE MA POSITION, et uniquement en local (mon pays /
--  partout) ; en cross-border (autre pays) on reste à l'échelle du pays.
-- =============================================================================

-- Coordonnées de l'utilisateur (captées via expo-location, permission requise).
alter table public.profiles
  add column if not exists current_lat double precision,
  add column if not exists current_lng double precision;

-- Préférence de recherche : pays cible (ISO alpha-2, null = partout) + rayon km
-- (null = sans limite). Remplace l'ancien filtre `regions` (continents).
alter table public.match_preferences
  add column if not exists search_country   text,
  add column if not exists search_radius_km integer;
