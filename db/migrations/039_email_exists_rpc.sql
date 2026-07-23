-- ─────────────────────────────────────────────────────────────────────────────
-- 039 — VÉRIFIER auth.users, PAS SEULEMENT public.profiles.
--
-- /auth/check-email (register.tsx, vérification live avant signUp) interrogeait
-- profiles.email. Or un compte peut exister dans auth.users SANS ligne profiles :
-- l'app ferme entre le signUp Supabase et le premier passage par /auth/ensure-
-- profile (jamais confirmé, ou tué avant la 1re connexion). Dans ce cas le check
-- répondait « disponible » à tort, et le vrai signUp échouait juste après avec
-- « already registered » — un message intermédiaire trompeur. Cas réel rencontré
-- plusieurs fois en test.
--
-- auth.users n'est PAS exposé par PostgREST (schéma non public, RLS de toute
-- façon inapplicable à un rôle anon/authenticated dessus). Le contournement
-- standard Supabase : une fonction SECURITY DEFINER dans public, qui s'exécute
-- avec les droits de son PROPRIÉTAIRE (a accès à auth.users) mais qu'on peut
-- appeler via RPC depuis n'importe quel rôle autorisé en EXECUTE. Elle ne
-- renvoie qu'un booléen — aucune donnée personnelle n'est exposée.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists(
    select 1 from auth.users where lower(email) = lower(p_email)
  );
$$;

-- Par défaut PostgreSQL/Supabase donne EXECUTE à PUBLIC sur toute nouvelle
-- fonction : on le retire explicitement puis on ne l'ouvre qu'aux deux rôles
-- qui en ont besoin (le check est appelé AVANT authentification, donc anon inclus).
revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
