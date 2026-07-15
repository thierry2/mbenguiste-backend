-- =============================================================================
--  Profil de démo « vitrine complète » — Aïcha (compte seedé par scripts/seed.js,
--  email demo.aicha@mbenguiste.dev). À exécuter dans Supabase. Idempotent.
--
--  Remplit TOUTES les sections du portrait éditorial :
--    plaque (bio serif + signature métier·origine·taille) · 01 Ce qu'elle cherche
--    · 02 Sa vie · 3 exergues (prompts) · 03 Ses rythmes · 5 photos.
--
--  Pré-requis : migrations 012 + 013 passées, et `node scripts/seed.js` déjà joué.
-- =============================================================================

-- 1) Le profil lui-même (nouveaux descripteurs + lifestyle complet).
update public.profiles p set
  bio              = 'Maman de cœur avant tout. J''aime les dimanches lents, la cuisine qui prend son temps et les vraies conversations.',
  occupation       = 'Pédiatre',
  height_cm        = 167,
  origin_country   = 'CI',
  current_country  = 'FR',
  current_city     = 'Paris',
  spoken_languages = array['Français','Dioula','Anglais'],
  is_verified      = true,
  relationship_goal_id = (select id from public.relationship_goals where code = 'serious'),
  lifestyle = '{
    "astro":"leo", "education":"master", "family":"someday",
    "religion":"christianity", "living":"alone",
    "smoking":"no", "drinking":"social", "sport":"often", "pets":"cat",
    "communication":"calls", "love_language":"quality_time"
  }'::jsonb,
  updated_at = now()
where p.email = 'demo.aicha@mbenguiste.dev';

-- 2) Cinq photos (portraits Unsplash stables, déjà éprouvés par le seed).
delete from public.profile_photos
  where profile_id in (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev');

insert into public.profile_photos (profile_id, url, position)
select c.id, v.url, v.pos
from (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev') c
cross join (values
  ('https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=900&q=80&fit=crop', 0),
  ('https://images.unsplash.com/photo-1589156280159-27698a70f29e?w=900&q=80&fit=crop', 1),
  ('https://images.unsplash.com/photo-1531727991582-cfd25ce79613?w=900&q=80&fit=crop', 2),
  ('https://images.unsplash.com/photo-1611432579699-484f7990b127?w=900&q=80&fit=crop', 3),
  ('https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=900&q=80&fit=crop', 4)
) as v(url, pos);

-- 3) Trois réponses (les exergues serif du portrait).
delete from public.profile_prompts
  where profile_id in (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev');

insert into public.profile_prompts (profile_id, prompt_id, answer, position)
select c.id, pr.id, v.answer, v.pos
from (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev') c
join (values
  ('perfect_sunday', 'Un marché le matin, une longue sieste, et des amis à table le soir.', 0),
  ('move_for_love',  'Quelqu''un qui me fait rire aux éclats et qui sait où il va.',        1),
  ('green_flag',     'La douceur, et le sens de la famille.',                               2)
) as v(code, answer, pos) on true
join public.prompts pr on pr.code = v.code;

-- 4) Les centres d'intérêt (chips vertes de « Ses rythmes »).
delete from public.profile_interests
  where profile_id in (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev');

insert into public.profile_interests (profile_id, interest_id)
select c.id, i.id
from (select id from public.profiles where email = 'demo.aicha@mbenguiste.dev') c
join public.interests i on i.code in ('afrobeats', 'cooking', 'travel', 'yoga');

-- Vérification : tout doit être rempli.
select p.first_name, p.occupation, p.height_cm, p.origin_country, p.current_city,
       p.is_verified, jsonb_object_keys(p.lifestyle) as lifestyle_kinds,
       (select count(*) from public.profile_photos  ph where ph.profile_id = p.id) as photos,
       (select count(*) from public.profile_prompts pp where pp.profile_id = p.id) as prompts,
       (select count(*) from public.profile_interests pi where pi.profile_id = p.id) as interets
from public.profiles p where p.email = 'demo.aicha@mbenguiste.dev';
