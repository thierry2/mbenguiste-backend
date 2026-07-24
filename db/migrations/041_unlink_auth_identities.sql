-- ─────────────────────────────────────────────────────────────────────────────
-- 041 — DÉTACHER LES IDENTITÉS OAUTH À LA PURGE.
--
-- Le correctif précédent (brouillage e-mail + bannissement à la purge) suffit
-- pour un compte E-MAIL : le prochain signUp avec la même adresse repart d'un
-- compte neuf. Mais PAS pour un compte GOOGLE.
--
-- Un compte OAuth est relié par son IDENTITÉ (auth.identities : provider + sub
-- Google), pas par l'e-mail. Brouiller `auth.users.email` laisse l'identité
-- Google COLLÉE au compte tombstone banni. Résultat : à la reconnexion Google,
-- Supabase retrouve l'identité → tombe sur le compte banni → refuse la session →
-- l'app retombe sur l'accueil sans un mot. Impossible de revenir.
--
-- On détache donc les identités. `auth` n'est pas exposé par PostgREST : il faut
-- une fonction SECURITY DEFINER (même procédé que 039). Après détachement, la
-- prochaine connexion Google ne trouve plus d'identité → crée un compte NEUF
-- (et l'e-mail brouillé du tombstone évite la collision d'unicité). La ligne
-- `auth.users` tombstone, elle, reste en place : c'est l'ancre de clé étrangère
-- du profil anonymisé et des messages envoyés à d'autres.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.unlink_auth_identities(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public, auth
as $$
  with removed as (
    delete from auth.identities where user_id = p_user_id returning 1
  )
  select count(*)::int from removed;
$$;

-- Appelée UNIQUEMENT côté serveur (service_role, dans purgeAccount). On retire
-- le grant par défaut à PUBLIC et on n'ouvre EXECUTE qu'au service_role : aucun
-- client anon/authenticated ne doit pouvoir détacher l'identité de qui que ce soit.
revoke all on function public.unlink_auth_identities(uuid) from public;
grant execute on function public.unlink_auth_identities(uuid) to service_role;
