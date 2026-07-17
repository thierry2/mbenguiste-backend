-- =============================================================================
--  021 · Embeddings photo — fondation similarité visuelle (17/07)
--        cf. docs/cahier-similarite-visuelle.md §2 (décision : CLIP/SigLIP LOCAL)
--
--  Chaque photo reçoit une empreinte numérique (SigLIP 2 base, 768 dims) qui
--  capte le style/ambiance — PAS de reconnaissance faciale (RGPD, §8 du cahier).
--  `profiles.photo_vec` = moyenne pondérée des embeddings du profil (la photo
--  principale compte double) → signature visuelle du profil, comparée au goût
--  appris du viewer (viewer_taste, migration 022) par simple cosinus.
--
--  halfvec + HNSW : pattern déjà éprouvé (AfrikMoms halfvec(3072)). Idempotente.
-- =============================================================================

create extension if not exists vector;

-- L'empreinte d'UNE photo (générée à l'upload + backfill scripts/backfill-embeddings.js).
alter table public.profile_photos
  add column if not exists embedding halfvec(768);

-- La signature visuelle du PROFIL (recalculée quand ses photos changent).
alter table public.profiles
  add column if not exists photo_vec halfvec(768);

-- Recherche « profils au style proche du goût du viewer » (deck / picks / Mystère).
create index if not exists idx_profiles_photo_vec_hnsw
  on public.profiles using hnsw (photo_vec halfvec_cosine_ops);

-- Recherche photo→photos quasi identiques CROSS-profil (anti-catfish, phase 2).
create index if not exists idx_profile_photos_embedding_hnsw
  on public.profile_photos using hnsw (embedding halfvec_cosine_ops);
