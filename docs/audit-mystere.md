# Audit Mystère / Aventure — chemin vers la prod

_Établi le 21/07/2026. Objectif : une solution premium, déterministe, testée, sans point de désynchronisation entre les deux joueurs._

## Résumé exécutif

Le concept et la majorité du code sont bons ; **ce qui empêche d'aller en prod n'est pas la logique de jeu, mais quatre choses** :

1. **Architecture « deux cerveaux »** (bloquant #1) — le serveur ET chaque client résolvent le jeu en parallèle. C'est la cause racine des désynchros (intime vu par un seul, Joker qui bloque l'autre). → **Refactor « cerveau unique ».**
2. **Décalage de déploiement** (bloquant #2) — la prod Railway tourne un état antérieur ; le code fini vit sur `feat/mystere-aventure`, jamais mergé dans `main`.
3. **Décalage de schéma DB** (bloquant #3) — migrations non passées en prod (`tours_desaccord` corrigée à chaud, `033` `left` en attente).
4. **Découverte sans notification** (bloquant #4) — rien ne prévient qu'un mystère attend ; il faut ouvrir l'onglet.

Le reste (déterminisme piloté par le graphe, vrais indices, robustesse, sécurité) est listé plus bas, priorisé.

---

## 1. Architecture — le « deux cerveaux » (PRIORITÉ 1)

### Constat
Le serveur résout et fait avancer la session dans `POST /discovery/mystere/answer`
(`aventure.service.soumettre` → `advanceSession`). **Mais le client ne suit pas** :
à la réception de la réponse du partenaire (Realtime `aventure_answers`), il
**rejoue le moteur localement** (`resoudreEpreuve` dans `[id].tsx#beginEpreuve`)
et avance sur son **propre `nodeId`** via `advanceTo`. La ligne de session
n'est suivie que pour Joker/`left` (`aventureSession.actionSession`) — jamais pour
le flux normal (aveu confirmé dans le commentaire de `realtime/aventureSession.ts`).

### Conséquence
Deux sources de vérité (session serveur vs état local de chaque téléphone) qui
**ne se réconcilient jamais** pour le flux normal. Toute divergence est définitive :
- `toursDesaccord` est un **compteur local** → l'injection de l'intime
  (`doitInjecterIntime(tour)`) et le canal de négociation
  (`nodeId::negoc::toursDesaccord`) divergent → **intime vu par un seul**, ou les
  deux qui s'attendent sur deux canaux différents.
- Le client en `attente` qui reçoit un Joker par la session n'annule pas
  forcément l'attente en cours → **Joker qui bloque l'autre**.

### Correction : cerveau unique (serveur autoritaire, client qui suit)
- Le client **envoie sa réponse** et rien d'autre.
- Le serveur tranche (il le fait déjà) et écrit l'état COMPLET dans la session :
  `current_node`, `tours_desaccord`, `outcome`, **+ une `phase`** et de quoi
  savoir s'il faut jouer un clip de conséquence / une reprise / une négociation.
- Les **deux clients rendent la session** reçue en Realtime. Suppression de
  `resoudreEpreuve`/`advanceTo`/`toursDesaccord` locaux et du canal de négociation
  calculé côté client.
- La colonne `phase` existe déjà dans `aventure_sessions` (migration 031) mais
  n'est pas utilisée — c'est le point d'ancrage naturel.

**Bénéfice** : désynchro impossible par construction ; latence supplémentaire
négligeable (jeu déjà asynchrone). C'est aussi ce qui rend le déterminisme
**vérifiable de bout en bout** (un seul calcul, testé côté serveur).

### Plan (TDD)
1. Backend : enrichir `soumettre` pour renvoyer/écrire la phase + le clip à jouer,
   et déplacer la décision d'intime/négociation (`doitInjecterIntime`) côté
   serveur (déjà en domaine pur, `adventureEngine`/`domain/aventure` → à porter).
2. Backend : `getSession`/le payload Realtime exposent `phase`, `tours_desaccord`,
   `clip_consequence`.
3. Front : un réducteur pur `vueDepuisSession(session, graph)` → ce que l'écran
   rend (clip courant, feuille ouverte/fermée, question, fin). Testé unitairement.
4. Front : `[id].tsx` s'abonne à la session et rend `vueDepuisSession` ; on
   retire la résolution locale. Reprise/rattrapage = relire la session.
5. Tests : contrats DB (PGlite) sur la séquence complète à deux + unitaires sur
   `vueDepuisSession`.

---

## 2. Déploiement (PRIORITÉ 1)

- La prod (`mbenguiste-backend-production.up.railway.app`) répondait « Route
  introuvable » puis « Aventure introuvable » : elle tourne un état antérieur au
  temps réel. Railway suit `origin/main`, qui **n'a aucune route Mystère**.
- Tout le backend fini est sur `feat/mystere-aventure` (poussé sur origin).
- **Action** : `railway up` depuis `backend/`, OU merger `feat/mystere-aventure`
  → `main` puis push. Vérifier `/health` puis `POST /mystere/answer` (ne doit plus
  renvoyer « Route introuvable »).

---

## 3. Schéma DB / migrations (PRIORITÉ 1)

- `aventure_sessions.tours_desaccord` **manquait en prod** (031 partielle) →
  `getSession` échouait silencieusement → « Aventure introuvable ». **Corrigé à
  chaud** (`alter table ... add column if not exists tours_desaccord ...`).
- `033_mystere_left_state.sql` (état `left`) **à passer** en prod, sinon `/leave`
  plante sur la contrainte CHECK.
- **Action** : rejouer 031 (idempotente) + 032 + 033 en prod, puis
  `notify pgrst, 'reload schema';`. Mettre en place un **process de migration
  fiable** (le décalage schéma est un risque récurrent, cf. §8).

---

## 4. Déterminisme piloté par le graphe (PRIORITÉ 2)

- Bug vécu : accord AA → mort, car `node.accord.proba` **absent du graphe** →
  `rng() < undefined` = `false` → mort. Corrigé en ajoutant `proba: 1` **dans le
  graphe** (la bonne place).
- Mais « on réussit tout sauf la finale » est **codé en dur** côté client
  (`estEpreuveFinale` + `reussiteForcee` + `rngForce` dans `[id].tsx`) : ça
  **ignore le `proba` du graphe** pour la finale. Exigence produit : le
  déterminisme doit être **configurable dans le graphe** (proba par épreuve ;
  le Joker monte la proba de la révélation).
- **Action** : après le cerveau unique, faire calculer l'issue par le serveur à
  partir du `proba` du graphe (plus de `rngForce` en dur) ; le Joker pose un flag
  de session que le moteur lit pour forcer la réussite de la révélation.

---

## 5. Indices réels (PRIORITÉ 2)

- Les indices affichés pendant l'aventure (ville, goût, aveu, prénom, âge)
  étaient **codés en dur** (`LADDER_DEFAUT`), identiques pour tous. Seul le
  **visage** final est réel (`/mystere/reveal`, post-match).
- **Livré** : `GET /discovery/mystere/indices` (texte only, jamais la photo,
  dérivé du profil du partenaire, `null` si non renseigné) + `attributsIndices`
  (domaine pur, testé) + `ladderReel` côté front (testé) branché dans
  `RecompenseBeat`/`EchecEnd`, fail-soft.
- **Reste** : le beat choisit l'indice par **numéro d'étape**, pas par
  `node.reveal`. Brancher `node.reveal → le bon cran` pour un ordre 100 % piloté
  par le graphe. Décision produit actée : tout le texte est rapatrié d'un coup ;
  la **photo nette reste servie seulement après le match**.

---

## 6. Découverte / notification (PRIORITÉ 2)

- Aucune notification quand une paire naît → il faut ouvrir l'onglet. Stopgap
  livré : re-fetch au focus/retour d'avant-plan de l'onglet Mystère.
- Realtime direct sur `mystere_pairs` **impossible** (table fermée au client pour
  l'anonymat : elle porte l'identité). La bonne voie est le **push** (« Un mystère
  t'attend », sans identité).
- **Livré (ce lot)** : `onMystereProposed` (push anonyme) appelé à la création de
  paire (passe + forcePair) ; handler front `type: 'mystere_proposed'` → refetch
  in-app + tap ouvre l'onglet.

---

## 7. Sécurité / RLS (PRIORITÉ 2)

- ✅ `mystere_pairs` : RLS activé **sans policy** (fermée au client) — l'identité
  du partenaire ne fuit pas. Bon.
- ⚠️ `aventure_answers` a une **policy d'INSERT client** (`role = mystere_role`).
  Le flux passe par `/answer` (service_role), donc cette policy est une surface
  inutile : un client pourrait insérer des réponses en direct (forger un index,
  répondre pour un nœud arbitraire). Avec le cerveau unique, **retirer la policy
  d'écriture client** (seul le backend écrit) — intégrité renforcée.
- ⚠️ `/mystere/reveal` ne sert le profil que si `revealedPartner` (paire `won`) :
  la photo nette ne fuit pas avant le match. Bon — à préserver au refactor.
- ⚠️ Rappel hors-Mystère (audit 20/07) : `authenticated` lit trop large
  (GPS/emails) ailleurs dans le schéma — à traiter dans l'audit sécurité global.

---

## 8. Robustesse du code (PRIORITÉ 3)

- **Catch muets** : `getSession` (et d'autres I/O de `mystere.model`) ignorent le
  `error` Supabase → une erreur DB (colonne manquante, RLS) devient un `null`
  silencieux et une énigme (c'est ce qui a masqué `tours_desaccord`). → Faire
  remonter l'erreur (tâche déjà ouverte).
- **Décalage schéma récurrent** : mettre en place une table `schema_migrations`
  + un runner idempotent au démarrage, pour que « migration pas passée » ne soit
  plus jamais une cause de bug en prod.
- **Sélection de graphe** : `randomGraph` tire n'importe quel graphe (pas de flag
  « actif »). Ajouter un `is_active`/`published` pour contrôler ce qui est jouable.

---

## 9. Bugs UX tranchés

- **Clignotement des questions au démarrage** : CORRIGÉ (garde `hydrated` sur
  l'effet de reset de phase, `[id].tsx`).
- **Saut clip1→clip2** : très probablement (a) build front périmé et/ou (b) clips
  de conséquence 404 (URLs du graphe pointant vers des fichiers absents) — graphe
  corrigé (clip1-6 + succes/mort/reprise). À reconfirmer avec les traces `[AVX]`
  temporaires (à retirer ensuite).
- **`Unable to activate keep awake`** : bénin, vient d'`expo-video` sur MIUI,
  dev-only. Ignorable (ou `LogBox.ignoreLogs`).

---

## 10. Ordre d'exécution recommandé

1. **Déployer** le backend + passer les migrations (031/032/033) → débloque tout
   de suite le jeu à deux tel qu'il est (§2, §3).
2. **Cerveau unique** (§1) → supprime les désynchros. LE chantier structurant.
3. **Notification** (§6) → découverte propre. _(livré dans ce lot)_
4. **Déterminisme graphe** (§4) + **indices `node.reveal`** (§5).
5. **Durcissement** : retirer la policy d'écriture client, catch muets, runner de
   migrations, flag `is_active` graphe (§7, §8).
6. Retirer les traces `[AVX]` (grep `TEMP DEBUG [AVX]`).

Chaque étape en TDD (backend `node --test` : domaine pur + contrats PGlite ;
front `jest`). Objectif tenu : **un seul cerveau, déterministe, testé**.
