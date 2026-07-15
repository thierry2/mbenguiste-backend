-- =============================================================================
--  Migration 002 — Storage (photos de profil + médias de chat) & médias de message
-- =============================================================================
--  À exécuter APRÈS db/schema.sql. Idempotent.
-- =============================================================================

-- 1) Médias des messages ------------------------------------------------------
-- Un message peut désormais être une image (ou vidéo) sans texte. On stocke le
-- CHEMIN privé (pas d'URL) — la lecture passe par une URL signée temporaire.
alter table public.messages alter column body drop not null;
alter table public.messages add column if not exists media_path text;
alter table public.messages add column if not exists media_type text;   -- 'image' | 'video'
-- Un message doit avoir au moins du texte OU un média.
alter table public.messages drop constraint if exists chk_message_content;
alter table public.messages add constraint chk_message_content
  check (body is not null or media_path is not null);

-- 2) Buckets de stockage ------------------------------------------------------
-- `photos`     : PUBLIC — photos de profil, visibles en découverte avant tout match.
-- `chat-media` : PRIVÉ  — images échangées en message, servies via URL signée courte.
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('chat-media', 'chat-media', false)
  on conflict (id) do nothing;

-- 3) Policies Storage ---------------------------------------------------------
-- Le backend (service_role) contourne la RLS pour écrire ; ces policies encadrent
-- l'accès direct depuis le client.

-- photos : lecture publique, écriture réservée au propriétaire (dossier = son uid).
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists photos_write_own on storage.objects;
create policy photos_write_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- chat-media : aucune lecture publique (URLs signées via backend uniquement) ;
-- écriture réservée au propriétaire du dossier.
drop policy if exists chat_media_write_own on storage.objects;
create policy chat_media_write_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4) Realtime -----------------------------------------------------------------
-- Le chat live s'abonne aux INSERT/UPDATE de `messages` via postgres_changes :
-- la table doit appartenir à la publication `supabase_realtime`. La policy SELECT
-- `messages_read_own` (schema.sql) garantit que chacun ne reçoit que SES messages.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;  -- déjà dans la publication
end $$;
