-- =============================================================================
--  Migration 005 — Genre : Homme / Femme uniquement
-- =============================================================================
--  À exécuter dans Supabase. Idempotent.
--
--  Décision produit : l'app ne propose que Femme / Homme (aucune obligation
--  légale dans les marchés cibles). On retire donc l'option non-binaire.
--  On détache d'abord les FK (profils + préférences) pour respecter les
--  contraintes, puis on supprime la ligne de référence.
-- =============================================================================

update public.profiles
  set gender_id = null
  where gender_id = (select id from public.genders where code = 'nonbinary');

update public.match_preferences
  set seeking_gender_id = null
  where seeking_gender_id = (select id from public.genders where code = 'nonbinary');

delete from public.genders where code = 'nonbinary';
