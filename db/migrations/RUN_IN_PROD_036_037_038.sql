-- =============================================================================
-- À PASSER EN PROD (Supabase → SQL Editor) — consolidé 036 + 037 + 038.
-- Idempotent : relançable sans risque.
--
-- 036 corrige le blocage constaté le 22/07 : après avoir mis fin à un mystère
-- depuis l'app, `force-mystere-pair.js` échouait sur
-- « duplicate key … mystere_pairs_user_low_user_high_key ». La contrainte
-- d'origine interdit à deux personnes qui ont DÉJÀ terminé un mystère ensemble
-- d'en refaire un — en test c'est bloquant, en production ça retire
-- silencieusement des couples compatibles du vivier.
--
-- APRÈS ce script : redéployer le backend (037 et 038 ajoutent du code qui
-- lit/écrit ces objets).
-- =============================================================================

-- ── 036 ─────────────────────────────────────────────────────────────────────
-- =============================================================================
-- 036 — L'UNICITÉ D'UNE PAIRE NE VAUT QUE TANT QU'ELLE EST VIVANTE.
--
-- `mystere_pairs` portait `unique (user_low, user_high)` SANS condition d'état.
-- Conséquence : deux personnes qui ont terminé un mystère ensemble — gagné,
-- quitté, ou dissous — ne pouvaient plus JAMAIS être appariées. La ligne
-- terminale restait et bloquait toute nouvelle insertion.
--
-- Deux dégâts, un visible et un qui l'était moins :
--   · en test, `forcePair` échoue dès la deuxième tentative sur les deux mêmes
--     comptes (violation de contrainte) — il fallait supprimer la ligne à la
--     main entre chaque essai ;
--   · en production, la passe d'appariement écarte silencieusement un couple
--     compatible parce qu'ils se sont croisés une fois. Sur un vivier jeune,
--     ça retire des candidats sans que personne ne le voie.
--
-- L'unicité DEVIENT PARTIELLE : deux personnes ne peuvent avoir qu'un seul
-- mystère NON TERMINAL à la fois — ce qui est la vraie règle métier — mais leur
-- historique n'interdit plus l'avenir. La garantie « un seul mystère à la fois
-- par personne » reste, elle, tenue par le trigger `mystere_one_active_trg`,
-- qui est plus strict et n'est pas touché ici.
--
-- Idempotent : relançable sans risque.
-- =============================================================================

-- La contrainte d'origine est nommée par Postgres (mystere_pairs_user_low_user_high_key)
-- mais on ne s'y fie pas : on la retrouve par sa DÉFINITION.
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'mystere_pairs'
    and con.contype = 'u'
    and pg_get_constraintdef(con.oid) = 'UNIQUE (user_low, user_high)';
  if c is not null then
    execute format('alter table public.mystere_pairs drop constraint %I', c);
  end if;
end $$;

-- Un seul mystère VIVANT par duo. Les paires terminées ('won', 'lost', 'left',
-- 'dissolved') s'accumulent librement : c'est l'historique, il ne bloque rien.
create unique index if not exists uniq_mystere_pair_vivante
  on public.mystere_pairs (user_low, user_high)
  where state in ('proposed', 'active');

-- PostgREST relit son cache de schéma.
notify pgrst, 'reload schema';

-- ── 037 ─────────────────────────────────────────────────────────────────────
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

-- ── 038 ─────────────────────────────────────────────────────────────────────
-- ─────────────────────────────────────────────────────────────────────────────
-- 038 — LA RELANCE DOUCE.
--
-- Une aventure s'endort quand l'un a répondu et que l'autre ne revient pas. Le
-- binôme est prévenu UNE fois (« on t'attend ») ; si la notification a été
-- balayée, plus rien ne le lui redit et la partie meurt en silence.
--
-- Cette colonne mémorise la relance DÉJÀ ENVOYÉE pour le tour en cours. C'est
-- elle qui garantit la règle : UNE relance par tour, jamais deux. Sans état
-- persisté, un serveur qui redémarre relancerait à chaque tick — et le filet
-- deviendrait du harcèlement.
--
-- Elle est remise à NULL à chaque avancée de session (`advanceSession`) : un
-- nouveau tour a droit à son propre filet.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.aventure_sessions
  add column if not exists relance_at timestamptz;

-- Le job cherche les sessions EN COURS et pas encore relancées. L'index partiel
-- garde ce balayage minuscule quel que soit l'historique : seules les lignes
-- réellement candidates y entrent.
create index if not exists idx_aventure_sessions_relance
  on public.aventure_sessions (id)
  where outcome is null and relance_at is null;

notify pgrst, 'reload schema';
