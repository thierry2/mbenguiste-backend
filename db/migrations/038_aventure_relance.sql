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
