-- =============================================================================
--  Migration 024 — Centre de sécurité
-- =============================================================================
--  À exécuter dans Supabase AVANT le déploiement Railway. Idempotente.
--
--  1. Motifs de signalement v2 : 4 nouveaux codes (scam, threats, hate,
--     offline_behavior) et libellés réalignés sur les maquettes. Les codes
--     historiques restent valides — les anciens dossiers gardent leur FK,
--     les anciens clients peuvent encore les envoyer.
--  2. matches.ended_at : l'unmatch/blocage reste un soft delete, désormais
--     DATÉ — l'écran « Anciennes connexions » affiche « Match défait le … ».
--     Les lignes déjà inactives gardent ended_at null (affichage sans date).
--  3. freeform_reports : dossier libre quand la personne n'apparaît plus dans
--     aucune connexion (« son profil n'apparaît pas ici ») — l'équipe retrouve
--     le profil à la main. Même confidentialité que reports.
-- =============================================================================

-- 1. Motifs v2 ----------------------------------------------------------------
insert into public.report_reasons (code, display_name, display_order) values
  ('scam','Demande d''argent ou arnaque',1),
  ('fake','Faux profil ou usurpation',2),
  ('harassment','Harcèlement ou insistance',3),
  ('threats','Menaces ou violence',4),
  ('inappropriate','Contenu sexuel non sollicité',5),
  ('hate','Propos haineux',6),
  ('offline_behavior','Une rencontre en personne',7),
  ('underage','Personne mineure',8),
  ('other','Autre chose',9)
on conflict (code) do update
  set display_name = excluded.display_name, display_order = excluded.display_order;

-- 2. Soft delete daté ---------------------------------------------------------
alter table public.matches add column if not exists ended_at timestamptz;

-- 3. Dossiers libres ----------------------------------------------------------
create table if not exists public.freeform_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  status       text not null default 'open',              -- 'open' | 'reviewing' | 'closed'
  created_at   timestamptz not null default now(),
  constraint chk_freeform_body_len check (char_length(body) between 20 and 2000)
);
create index if not exists idx_freeform_reports_status on public.freeform_reports (status, created_at);

-- RLS : table lue/écrite uniquement par le backend (service role). On active la
-- RLS sans policy pour que anon/authenticated n'y touchent jamais en direct.
alter table public.freeform_reports enable row level security;
