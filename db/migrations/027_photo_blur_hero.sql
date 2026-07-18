-- 027 — Masque « héros » : seconde version floutée, calibrée pour le PLEIN ÉCRAN.
--
-- Le masque de la migration 011 (`blur_url`, 220×300 + sigma 20) est taillé pour
-- les tuiles de la grille Likes. Étalé sur la carte Mystère plein cadre, il est
-- agrandi ~7× au lieu de ~2× : le même flou devient trois fois plus épais à
-- l'œil et l'image ne montre plus aucune forme humaine — juste un halo.
--
-- D'où une seconde variante, plus grande (720×1280, proche du ratio d'un
-- téléphone) et moins floutée, pour que la silhouette redevienne lisible SANS
-- que le visage le devienne. Les deux coexistent : la grille garde `blur_url`,
-- le plein écran prend `blur_hero_url`.
--
-- ⚠ Cette variante laisse volontairement passer PLUS d'information que l'autre.
-- Elle vit sur le même bucket public, donc elle doit rester sûre TOUTE SEULE :
-- le flou ajouté côté client ne compte pas dans la sécurité. Le réglage a été
-- choisi à l'œil (scripts/calibrate-hero-blur.js), pas calculé.
alter table public.profile_photos add column if not exists blur_hero_url text;

