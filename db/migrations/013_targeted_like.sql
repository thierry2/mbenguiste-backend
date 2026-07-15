-- =============================================================================
--  Migration 013 — Like ciblé (« aimer ce détail », façon Hinge)
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Sur le profil consulté, chaque photo et chaque réponse porte un cœur : on
--  aime CE détail précis, avec un mot en option. On garde la référence du contenu
--  aimé sur le swipe — elle devient l'amorce de conversation quand il y a match.
--
--    like_target_type : 'photo' | 'prompt' | null  (null = like global)
--    like_target_ref  : id de la photo (uuid texte) ou code du prompt
--    like_comment     : le petit mot joint au like (optionnel, ≤ 200)
-- =============================================================================

alter table public.swipes
  add column if not exists like_target_type text,
  add column if not exists like_target_ref  text,
  add column if not exists like_comment     text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_like_target_type'
  ) then
    alter table public.swipes
      add constraint chk_like_target_type
      check (like_target_type is null or like_target_type in ('photo', 'prompt'));
  end if;
end $$;

comment on column public.swipes.like_target_type is 'Type du contenu aimé : photo | prompt | null (like global).';
comment on column public.swipes.like_target_ref  is 'Référence du contenu aimé : id de photo ou code de prompt.';
comment on column public.swipes.like_comment     is 'Petit mot joint au like ciblé — amorce de conversation au match.';
