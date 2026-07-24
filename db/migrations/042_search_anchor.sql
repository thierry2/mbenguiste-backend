-- ─────────────────────────────────────────────────────────────────────────────
-- 042 — L'ANCRE DE RECHERCHE (base du « Passeport ») + LE FILET ANTI-FILE-VIDE.
--
-- ── L'ANCRE ─────────────────────────────────────────────────────────────────
-- Le rayon se mesurait toujours depuis `profiles.current_lat/lng` — ma position.
-- D'où une règle bancale : chercher dans un pays étranger rendait la mesure
-- absurde, donc le serveur IGNORAIT le rayon… sans que rien ne le dise (l'app
-- affichait « 50 km » sur un filtre inerte).
--
-- On sépare donc « où je suis » de « autour de quoi je cherche ». L'ancre est
-- le point de mesure : vide = ma position (comportement actuel, inchangé),
-- renseignée = un lieu CHOISI. C'est exactement le « Passeport » des apps de
-- référence (Tinder Passport, Bumble Travel), un produit vendable : la colonne
-- existe dès maintenant pour que l'ouvrir plus tard ne soit qu'un déverrouillage,
-- jamais une migration en urgence sur une table vivante.
--
-- `search_anchor_label` porte le nom lisible (« Paris ») : sans lui, l'app ne
-- pourrait afficher que des coordonnées, et un rayon doit s'ancrer à un lieu
-- NOMMÉ pour être compréhensible.
--
-- ── LE FILET ────────────────────────────────────────────────────────────────
-- `expand_if_empty` : quand le rayon ne laisse presque personne, on l'ignore
-- plutôt que de servir une file vide. Tinder fait de même (« montrer des
-- personnes légèrement hors de ma zone »), et ça compte DOUBLE sur un pool
-- réduit. Défaut `false` : on n'élargit jamais dans le dos de quelqu'un.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.match_preferences
  add column if not exists search_anchor_lat   double precision,
  add column if not exists search_anchor_lng   double precision,
  add column if not exists search_anchor_label text,
  add column if not exists expand_if_empty     boolean not null default false;

-- Une ancre est un COUPLE : une seule des deux coordonnées ne désigne aucun
-- point. Le domaine sait déjà l'ignorer (`ancrePour`), mais mieux vaut que la
-- base refuse d'écrire l'état incohérent que de compter sur chaque appelant.
alter table public.match_preferences
  drop constraint if exists match_preferences_anchor_complete;
alter table public.match_preferences
  add constraint match_preferences_anchor_complete
  check (
    (search_anchor_lat is null and search_anchor_lng is null)
    or (search_anchor_lat is not null and search_anchor_lng is not null)
  );

-- Bornes géographiques : une latitude hors [-90, 90] ou une longitude hors
-- [-180, 180] n'est pas un point sur Terre.
alter table public.match_preferences
  drop constraint if exists match_preferences_anchor_bounds;
alter table public.match_preferences
  add constraint match_preferences_anchor_bounds
  check (
    (search_anchor_lat is null or (search_anchor_lat between -90 and 90))
    and (search_anchor_lng is null or (search_anchor_lng between -180 and 180))
  );
