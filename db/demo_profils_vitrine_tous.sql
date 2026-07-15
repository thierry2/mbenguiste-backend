-- =============================================================================
--  Enrichit TOUS les profils de démo (seed.js) pour la vitrine éditoriale :
--  métier, taille, origine, lifestyle complet (11 kinds), vraies langues.
--  + photos supplémentaires pour David (2 → 5).
--  À exécuter dans Supabase APRÈS migrations 012/013 et `node scripts/seed.js`.
--  Idempotent. (Aïcha est incluse, cohérente avec demo_profil_vitrine.sql.)
-- =============================================================================

update public.profiles p set
  occupation       = v.metier,
  height_cm        = v.taille,
  origin_country   = v.origine,
  spoken_languages = v.langues,
  lifestyle        = v.ls::jsonb,
  updated_at       = now()
from (values
  ('demo.aicha@mbenguiste.dev',   'Pédiatre',             167, 'CI', array['Français','Dioula','Anglais'],
   '{"astro":"leo","education":"master","family":"someday","religion":"christianity","living":"alone","smoking":"no","drinking":"social","sport":"often","pets":"cat","communication":"calls","love_language":"quality_time"}'),
  ('demo.marieme@mbenguiste.dev', 'Sage-femme',           165, 'SN', array['Français','Wolof'],
   '{"astro":"capricorn","education":"bachelor","family":"want","religion":"islam","living":"with_family","smoking":"no","drinking":"never","sport":"sometimes","pets":"none","communication":"in_person","love_language":"words"}'),
  ('demo.fatou@mbenguiste.dev',   'Étudiante en droit',   170, 'ML', array['Français','Bambara'],
   '{"astro":"gemini","education":"student","family":"someday","religion":"islam","living":"roommates","smoking":"no","drinking":"never","sport":"sometimes","pets":"none","communication":"texting","love_language":"quality_time"}'),
  ('demo.grace@mbenguiste.dev',   'Comptable',            168, 'CD', array['Français','Lingala'],
   '{"astro":"virgo","education":"bachelor","family":"want","religion":"christianity","living":"alone","smoking":"no","drinking":"social","sport":"daily","pets":"none","communication":"calls","love_language":"acts"}'),
  ('demo.julien@mbenguiste.dev',  'Professeur de français', 180, 'FR', array['Français','Anglais'],
   '{"astro":"libra","education":"master","family":"someday","religion":"none","living":"alone","smoking":"quitting","drinking":"social","sport":"often","pets":"dog","communication":"in_person","love_language":"words"}'),
  ('demo.kwame@mbenguiste.dev',   'Ingénieur logiciel',   178, 'GH', array['Anglais','Twi','Français'],
   '{"astro":"aries","education":"master","family":"want","religion":"christianity","living":"alone","smoking":"no","drinking":"social","sport":"daily","pets":"none","communication":"texting","love_language":"quality_time"}'),
  ('demo.thomas@mbenguiste.dev',  'Restaurateur',         183, 'BE', array['Français','Néerlandais'],
   '{"astro":"taurus","education":"vocational","family":"want","religion":"christianity","living":"alone","smoking":"social","drinking":"social","sport":"sometimes","pets":"dog","communication":"in_person","love_language":"gifts"}'),
  ('demo.ibrahim@mbenguiste.dev', 'Développeur',          175, 'CM', array['Français','Anglais'],
   '{"astro":"scorpio","education":"master","family":"someday","religion":"islam","living":"roommates","smoking":"no","drinking":"never","sport":"often","pets":"cat","communication":"texting","love_language":"quality_time"}'),
  ('demo.sarah@mbenguiste.dev',   'Architecte',           169, 'MA', array['Français','Arabe','Anglais'],
   '{"astro":"aquarius","education":"master","family":"someday","religion":"islam","living":"alone","smoking":"no","drinking":"never","sport":"often","pets":"cat","communication":"calls","love_language":"quality_time"}'),
  ('demo.chloe@mbenguiste.dev',   'Chargée humanitaire',  171, 'CH', array['Français','Anglais'],
   '{"astro":"pisces","education":"master","family":"want","religion":"christianity","living":"roommates","smoking":"no","drinking":"social","sport":"often","pets":"none","communication":"in_person","love_language":"acts"}'),
  ('demo.david@mbenguiste.dev',   'Musicien',             182, 'CA', array['Français','Anglais'],
   '{"astro":"sagittarius","education":"bachelor","family":"someday","religion":"spiritual","living":"alone","smoking":"social","drinking":"social","sport":"sometimes","pets":"dog","communication":"calls","love_language":"touch"}'),
  ('demo.awa@mbenguiste.dev',     'Créatrice de mode',    166, 'CI', array['Français','Nouchi'],
   '{"astro":"aquarius","education":"vocational","family":"unsure","religion":"christianity","living":"with_family","smoking":"no","drinking":"social","sport":"sometimes","pets":"cat","communication":"texting","love_language":"gifts"}')
) as v(email, metier, taille, origine, langues, ls)
where p.email = v.email;

-- Photos supplémentaires pour David (2 → 5) : portraits masculins du pool
-- Unsplash déjà éprouvé par le seed (visages différents — c'est de la démo).
delete from public.profile_photos
  where profile_id in (select id from public.profiles where email = 'demo.david@mbenguiste.dev')
  and position >= 2;

insert into public.profile_photos (profile_id, url, position)
select c.id, v.url, v.pos
from (select id from public.profiles where email = 'demo.david@mbenguiste.dev') c
cross join (values
  ('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=900&q=80&fit=crop', 2),
  ('https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=900&q=80&fit=crop', 3),
  ('https://images.unsplash.com/photo-1543610892-0b1f7e6d8ac1?w=900&q=80&fit=crop', 4)
) as v(url, pos);

-- Vérification : plus aucun profil de démo sans métier / lifestyle vide.
select p.first_name, p.occupation, p.height_cm, p.origin_country,
       (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photos,
       (p.lifestyle = '{}'::jsonb) as lifestyle_vide
from public.profiles p
where p.email like 'demo.%@mbenguiste.dev'
order by p.first_name;
