# Spec — Cerveau unique (serveur autoritaire) pour l'Aventure

_But : supprimer par construction toute désynchronisation entre les deux joueurs
(intime vu par un seul, Joker qui bloque l'autre, canaux de négociation
divergents). Le serveur devient la SEULE source de vérité ; les deux clients
rendent la même session. Déterministe, testé de bout en bout._

## Principe

Aujourd'hui (« deux cerveaux ») : le serveur résout dans `/answer` ET chaque
client rejoue `resoudreEpreuve` puis avance sur son propre `nodeId`. Deux vérités
qui ne se réconcilient jamais pour le flux normal.

Cible (« un cerveau ») :
1. Le client **envoie sa réponse** et n'avance JAMAIS de lui-même.
2. Le serveur **résout** (il le fait déjà) et écrit l'**état complet** dans la
   ligne de session.
3. Les deux clients **s'abonnent à la session** et rendent l'état reçu. Un
   `nodeId` divergent devient impossible.

Le seul aspect intrinsèquement client, c'est le **timing de lecture vidéo** (le
client sait quand SA vidéo finit). On le gère par un aller-retour explicite
« clip fini » (voir Protocole), sans jamais laisser le client DÉCIDER de l'issue.

## Contrat de session (source de vérité)

`aventure_sessions` porte déjà : `current_node`, `phase`, `outcome`,
`joker_used`, `tours_desaccord`. On ajoute (migration 034) :

```sql
alter table public.aventure_sessions
  add column if not exists last_issue text          -- 'survie'|'mort'|'boucle'|null
    check (last_issue in ('survie','mort','boucle')),
  add column if not exists negocier boolean not null default false, -- intime de désaccord dû ?
  add column if not exists clip_a_jouer text;        -- clip de conséquence/reprise à jouer
```

`phase` (déjà présente) devient AUTORITAIRE et prend :
`scene · choix · attente · resolution · consequence · recompense · reprise ·
negociation · suivant · fin` (les mêmes que `aventureMachine.ts`, mais **côté
serveur**).

## Protocole (endpoints)

- `POST /mystere/answer { answerIndex | message }` — inchangé côté client, mais le
  serveur écrit désormais phase + last_issue + negocier + clip_a_jouer + outcome.
  Réponse : `{ waiting }` ou l'état résolu (le même que la session).
- `POST /mystere/clip-done { node }` — **nouveau**. Le client signale que la vidéo
  (scène, reprise ou conséquence) de `node` est finie. Le serveur fait avancer la
  phase (`scene→choix`, `consequence→suivant/recompense/fin`, `reprise→choix`) et
  réécrit la session. Idempotent (rejouer un `clip-done` déjà pris = no-op).
- Realtime : le payload `aventure_sessions` expose désormais `phase`,
  `tours_desaccord`, `last_issue`, `negocier`, `clip_a_jouer`, `current_node`,
  `outcome`, `joker_used`.

## Client — un réducteur pur + un abonnement

Remplacer la résolution locale par :

```ts
// src/lib/vueDepuisSession.ts (PUR, testé)
vueDepuisSession(session: SessionEtat, graph: Graph): VueEcran
// → { clip, feuilleOuverte, question, options, negociation, fin, ... }
```

`[id].tsx` :
- supprime `beginEpreuve`/`resoudreEpreuve`/`advanceTo`/`toursDesaccord` locaux et
  le canal `nodeId::negoc::toursDesaccord` calculé côté client ;
- s'abonne à la session (Realtime + rattrapage au montage) → `setSession` ;
- rend `vueDepuisSession(session, graph)` ;
- `onClipFini` → `POST /mystere/clip-done` (ne décide de rien) ;
- répondre → `POST /mystere/answer` (ne décide de rien).

La négociation utilise `session.tours_desaccord` (serveur) → **les deux clients
ont toujours le même canal**. L'intime de désaccord vient de `session.negocier`
(serveur) → **vu par les deux ou aucun**.

## Joker / left (déjà partiellement là)

`actionSession` disparaît : Joker et `left` sont juste des transitions de session
comme les autres (`current_node` = finale + `joker_used`, ou `outcome='left'`).
Le client qui était en `attente` suit la session → **plus de blocage** (le bug #2
disparaît sans traitement spécial).

## Déterminisme (couplé, cf. audit §4)

L'issue vient du `proba` du GRAPHE (plus de `rngForce` en dur côté client). Le
serveur : `survecu = rng() < node.accord.proba`. Le Joker pose `joker_used`, que
le serveur lit pour forcer la réussite de la révélation (proba effective = 1). Le
« réussir tout sauf la finale » se configure alors **entièrement dans le graphe**
(proba 1 partout, proba 0 sur la révélation ; Joker → 1).

## Plan d'exécution (TDD)

1. **Migration 034** (colonnes ci-dessus) + publication realtime déjà OK.
2. **Domaine serveur** : porter la table de transitions de `aventureMachine.ts`
   en JS pur (`domain/aventurePhase.js`) + tests `node --test` (miroir des tests
   `aventureMachine.test.ts`).
3. **`aventure.service`** : `soumettre` écrit phase+last_issue+negocier+clip ;
   nouveau `clipDone(sessionId, node)` fait avancer la phase. Tests service (fakes)
   + contrats DB PGlite sur une séquence complète à DEUX.
4. **Front** : `vueDepuisSession` pur + tests jest (exhaustifs : chaque phase,
   désaccord, négociation, joker, fins). PUIS wiring `[id].tsx` (suppression de la
   résolution locale) — **à valider sur device**.
5. **Nettoyage** : retirer la policy d'écriture client sur `aventure_answers`
   (seul le backend écrit), retirer `resoudreEpreuve`/`rngForce` du client.
6. Retirer les traces `[AVX]`.

## Estimation & risque

Gros mais borné. Le risque est concentré sur l'étape 4 (wiring écran) — d'où la
séparation stricte logique pure (testable, sûre) / wiring (device). Aucune étape
ne doit partir en prod sans que la précédente soit verte.

## Pourquoi ne pas l'avoir codé en une passe

Ce refactor change le schéma, le protocole et le cœur de l'écran. Le livrer sans
l'avoir lancé sur deux vrais téléphones serait un pari — l'inverse du « premium,
déterministe, testé » demandé. Cette spec le rend exécutable rapidement et
sûrement, étape verte par étape verte, dès validation.
