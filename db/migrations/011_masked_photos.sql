-- 011 — Version FLOUTÉE des photos de profil.
-- Le hub « Mystères » / la page « Likes » ne montrent JAMAIS le vrai visage
-- (il se mérite dans l'aventure). On sert cette image floutée à la place ;
-- l'originale ne quitte jamais le serveur dans ces contextes.
-- Générée côté serveur (fort downscale = irréversible), stockée dans le bucket
-- `photos` à un chemin ALÉATOIRE `masked/<uuid>.jpg` (l'URL ne révèle pas le profil).
alter table public.profile_photos add column if not exists blur_url text;

