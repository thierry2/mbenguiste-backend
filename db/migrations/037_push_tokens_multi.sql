-- ─────────────────────────────────────────────────────────────────────────────
-- 037 — UN COMPTE, PLUSIEURS APPAREILS.
--
-- `profiles.push_token` est une colonne UNIQUE : se connecter sur un second
-- téléphone écrasait le token du premier, qui devenait muet SANS RIEN DIRE.
-- C'est ce qui a coûté une session entière de diagnostic (21/07) — on cherchait
-- une panne de configuration FCM alors que le token appartenait à un autre
-- appareil.
--
-- Une table de tokens règle les deux problèmes d'un coup : on notifie TOUS les
-- appareils d'un compte, et un token mort se supprime tout seul (ligne à part)
-- au lieu de laisser le compte silencieux.
--
-- LA CLÉ EST LE TOKEN, PAS LE COUPLE (profil, token). Un même appareil peut
-- changer de compte : le token doit alors suivre le NOUVEAU compte, sinon
-- l'ancien propriétaire recevrait les notifications de quelqu'un d'autre. Le
-- `on conflict (token) do update` de l'enregistrement s'appuie là-dessus.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.push_tokens (
  token       text primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  platform    text,                       -- 'android' | 'ios' | null (informatif)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_push_tokens_profile on public.push_tokens(profile_id);

-- ── REPRISE DE L'EXISTANT ────────────────────────────────────────────────────
-- Sans ça, tout le monde perdrait ses notifications entre le déploiement et la
-- prochaine ouverture de l'app. On reprend les tokens déjà en base.
insert into public.push_tokens (token, profile_id)
select p.push_token, p.id
from public.profiles p
where p.push_token is not null
  and p.push_token like 'ExponentPushToken%'
on conflict (token) do nothing;

-- ⚠ `profiles.push_token` est VOLONTAIREMENT CONSERVÉE pour l'instant : un
-- backend déployé avant cette migration continuerait de l'écrire, et la
-- supprimer tout de suite ferait échouer ses écritures. Elle deviendra morte
-- une fois le nouveau code en production ; on la retirera dans une migration
-- ultérieure, quand plus rien ne la lira.

alter table public.push_tokens enable row level security;

-- Le serveur écrit et lit en `service_role` (bypass RLS). On n'ouvre au client
-- que la LECTURE de ses propres tokens — utile pour un futur écran « appareils
-- connectés », et surtout : aucun client ne doit pouvoir lire le token d'autrui
-- (ce serait de quoi lui envoyer des notifications directement via l'API Expo,
-- qui est publique).
drop policy if exists push_tokens_read_own on public.push_tokens;
create policy push_tokens_read_own on public.push_tokens
  for select to authenticated using (profile_id = auth.uid());
