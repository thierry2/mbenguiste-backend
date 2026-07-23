-- ─────────────────────────────────────────────────────────────────────────────
-- 040 — CONSENTEMENT CGU / DONNÉES SENSIBLES, TRACÉ POUR TOUT LE MONDE.
--
-- register.tsx (inscription e-mail) fait cocher deux cases avant même de créer
-- le compte (CGU + traitement des données sensibles — orientation révélée par
-- le genre recherché, religion). Mais le parcours Google (googleAuth.ts) ouvre
-- une session DIRECTEMENT, sans jamais les montrer — trou connu, documenté dans
-- register.tsx mais jamais traité.
--
-- `terms_accepted_at` porte la preuve. Pour les comptes Google, le passage par
-- le nouvel écran onboarding/consentement.tsx (gate _layout.tsx) devient
-- obligatoire avant l'onboarding. Pour les comptes e-mail, `completeOnboarding`
-- la tamponne en filet de sécurité (ils ont déjà coché les cases à l'inscription,
-- on ne fait qu'enregistrer la date).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists terms_accepted_at timestamptz;

-- Les comptes déjà onboardés ont nécessairement déjà passé un consentement
-- (register.tsx, ou l'app elle-même avant ce correctif) — ne pas les interrompre
-- rétroactivement avec le nouvel écran. Seuls les comptes FUTURS et ceux dont
-- l'onboarding n'est pas encore fini passeront par la vraie vérification.
update public.profiles
set terms_accepted_at = created_at
where onboarding_done = true and terms_accepted_at is null;
