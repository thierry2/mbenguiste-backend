-- =============================================================================
--  Migration 030 — Vérification par selfie (pose aléatoire, validation manuelle)
-- =============================================================================
--  À exécuter dans Supabase AVANT le déploiement Railway. Idempotente.
--
--  Rend le sceau `is_verified` ENFIN atteignable. Jusqu'ici il n'était écrit qu'à
--  `false` à la création du profil, jamais remis à `true` — filtre « vérifiés »
--  vide, bonus de ranking jamais déclenché, promesse retirée du centre de sécurité.
--
--  Flux : la personne demande une vérification → le SERVEUR tire une pose au
--  hasard (main sur l'oreille, sur la tête…) qu'elle ne peut pas connaître à
--  l'avance → selfie EN DIRECT (caméra) → un humain valide depuis la console
--  admin. Le tirage + la capture live sont le cœur de l'anti-fraude.
--
--  1. Bucket PRIVÉ pour les selfies (jamais publics — RGPD + sécurité).
--  2. Table verification_requests (machine à états + une seule requête active).
--  3. profiles.verified_at (audit ; is_verified reste le drapeau lu partout).
-- =============================================================================

-- 1. Bucket privé -------------------------------------------------------------
-- Sur le modèle de `chat-media` (migration 002) : aucune lecture publique, la
-- console admin lit via une URL signée courte générée côté backend (service_role).
insert into storage.buckets (id, name, public)
  values ('verification-selfies', 'verification-selfies', false)
  on conflict (id) do nothing;

-- Écriture réservée au propriétaire (dossier = son uid) ; aucune policy SELECT
-- → aucune lecture directe côté client, comme chat-media.
drop policy if exists verif_selfies_write_own on storage.objects;
create policy verif_selfies_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-selfies'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2. Demandes de vérification -------------------------------------------------
create table if not exists public.verification_requests (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  pose_code          text not null,                    -- pose imposée, tirée au hasard
  selfie_path        text,                             -- chemin bucket PRIVÉ (null tant que pas capturé)
  status             text not null default 'awaiting_selfie',
  attempt_no         int  not null default 1,          -- n° de tentative (cooldown après rejet)
  capture_expires_at timestamptz,                      -- fin de la fenêtre de CAPTURE (start→envoi) uniquement
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        text,                             -- marqueur admin (comme reports.admin_action)
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  constraint chk_verification_status check (
    status in ('awaiting_selfie', 'pending_review', 'approved', 'rejected', 'expired')
  )
);

-- Au plus UNE requête active par personne (en cours de capture ou en attente de
-- revue). Une fois approuvée/rejetée/expirée, elle libère la place — la personne
-- peut relancer une nouvelle vérification (nouvelle pose).
create unique index if not exists uniq_active_verification_per_user
  on public.verification_requests (user_id)
  where status in ('awaiting_selfie', 'pending_review');

-- File d'attente admin : les selfies en attente de revue, du plus ancien au plus
-- récent (on traite dans l'ordre d'arrivée).
create index if not exists idx_verification_review_queue
  on public.verification_requests (status, submitted_at);

-- Historique par personne (cooldown / dernier rejet).
create index if not exists idx_verification_user
  on public.verification_requests (user_id, created_at desc);

-- RLS : la personne ne touche QUE ses propres demandes ; le backend service_role
-- (console admin) contourne la RLS. Sans policy côté anon, rien ne fuite.
alter table public.verification_requests enable row level security;
drop policy if exists verification_own on public.verification_requests;
create policy verification_own on public.verification_requests
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Audit du sceau -----------------------------------------------------------
alter table public.profiles
  add column if not exists verified_at timestamptz;
