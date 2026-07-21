-- =============================================================================
--  Migration 032 — Graphes d'Aventure EN BASE (éditables depuis la console admin)
-- =============================================================================
--  Le graphe (nœuds + routage + clips/questions) vivait en dur dans le code
--  (domain/aventureGraphe.js côté serveur, adventureMock.ts côté client). On le
--  déplace en base pour qu'il soit éditable sans redéploiement, depuis /admin.
--
--  · La RÉSOLUTION serveur lit désormais le routage depuis cette table (repli sur
--    le graphe en code si la table est vide → aucun changement de comportement
--    tant qu'aucun graphe n'a été enregistré).
--  · La table est FERMÉE au client (RLS sans policy) : le backend seul (service
--    role) l'écrit et sert au client la présentation dont il a besoin.
--  Idempotente.
-- =============================================================================

create table if not exists public.aventure_graphs (
  id          text primary key,               -- ex. 'grotte-ci'
  title       text,
  -- Le graphe COMPLET : { start, nodes: { id: { kind, question, options, clip,
  -- accord, desaccord, oui, non, next, reveal, end, ambiance } } }. Routage
  -- (serveur) + présentation (client) dans un seul objet — la source unique.
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.aventure_graphs enable row level security;
-- Aucune policy : FERMÉE au client (le backend service_role fait tout).
