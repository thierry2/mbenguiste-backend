-- =============================================================================
--  Migration 029 — Colonnes de traitement manquantes sur freeform_reports
--                  (CORRECTIF, 19/07/2026)
-- =============================================================================
--  À exécuter dans Supabase. Idempotente. À passer MÊME SI la 025 a déjà été
--  appliquée — c'est précisément ce cas qu'elle répare.
--
--  LE SYMPTÔME (vu en production le 18/07) :
--    GET /api/v1/admin/moderation/dossiers-libres → 500
--    « column freeform_reports.admin_note does not exist »
--  alors que l'onglet « Dossiers » (table `reports`) répondait 200.
--
--  LA CAUSE : la migration 025 ajoute ces colonnes à DEUX tables — `reports`
--  puis `freeform_reports`. En production, seul le premier `alter table` a pris
--  effet. Le scénario qui colle : 025 lancée AVANT 024, donc `freeform_reports`
--  n'existait pas encore et son `alter table` a échoué, laissant la 025
--  à moitié appliquée. La 024 a ensuite créé la table — sans ces colonnes,
--  puisqu'elles appartiennent à la 025.
--
--  POURQUOI LES TESTS N'ONT RIEN VU : la suite DB (PGlite) exécute
--  `db/schema.sql`, qui contient bien ces colonnes. Le schéma de référence et
--  l'état réel des migrations avaient divergé — un test ne pouvait pas
--  l'attraper. Seule la prod pouvait parler.
--
--  Conséquence tant que ce n'est pas passé : les dossiers libres (récits écrits
--  par des femmes à qui l'app a promis qu'« un humain va le lire ») sont
--  ILLISIBLES depuis la console. Ils s'empilent sans pouvoir être traités.
-- =============================================================================

alter table public.freeform_reports
  add column if not exists admin_note   text,
  add column if not exists admin_action text,          -- 'retirer' | 'restaurer' | 'rejeter'
  add column if not exists treated_at   timestamptz;

-- Ceinture et bretelles : la même traçabilité sur `reports` (déjà en place en
-- production, mais on ne suppose plus rien — `if not exists` rend l'appel gratuit).
alter table public.reports
  add column if not exists admin_note   text,
  add column if not exists admin_action text,
  add column if not exists treated_at   timestamptz;
