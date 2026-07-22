# Gabarits d'e-mail Supabase — Mbenguiste

À coller dans **Dashboard → Authentication → Email Templates**. Un fichier par
gabarit ; le `<h2>` d'objet suggéré est en tête de chaque fichier, en commentaire.

## Pourquoi ces contraintes de code

Un e-mail n'est pas une page web. Ce qui est écrit ici l'est pour de bonnes raisons :

- **Tables et styles en ligne.** Outlook (moteur Word) ignore la plupart du CSS
  moderne : flexbox, grid, `<style>` externe. Une mise en page en `<div>` s'y
  effondre.
- **Aucune image.** La majorité des clients bloquent les images distantes par
  défaut ; un logo en `<img>` laisse un cadre vide chez la moitié des gens. La
  marque tient donc au texte et à la couleur.
- **Largeur 600 px.** Le plus petit dénominateur commun historique, toujours le
  plus sûr.
- **Le lien est AUSSI en texte brut.** Certains clients d'entreprise cassent les
  boutons ; sans l'URL visible, la personne est bloquée sans recours.

## La palette (miroir de `proTheme.ts`)

| Rôle | Valeur |
|---|---|
| encre | `#1B1A1E` |
| encre secondaire | `#66645E` |
| encre muette | `#9A968E` |
| accent chaud (« love ») | `#C25B54` |
| fond de carte | `#FFFFFF` |
| fond de page | `#F4F2EF` |
| filet | `#E8E5E0` |

`love` est la **seule** touche chaude de l'app : elle est réservée à l'action
principale. La répandre ailleurs lui ferait perdre son sens.

## Le ton

Mbenguiste n'est pas une app transactionnelle. On ne dit pas « Cliquez ici pour
valider votre inscription », on parle à quelqu'un. Les phrases sont courtes, sans
point d'exclamation, sans injonction. Le tutoiement, comme dans toute l'app.

## Variables Supabase disponibles

- `{{ .ConfirmationURL }}` — le lien complet, déjà signé
- `{{ .Token }}` — le code à 6 chiffres (si tu veux une saisie manuelle)
- `{{ .Email }}` — le destinataire
- `{{ .SiteURL }}` — l'URL de site configurée

## ⚠ Deux réglages à faire À CÔTÉ des gabarits

**1. Whitelister les URL de redirection** (Authentication → URL Configuration →
Redirect URLs) :

```
mbenguiste://reset-password
mbenguiste://auth-callback
```

Sans ça, le lien renvoie vers la Site URL et l'app ne reprend jamais la main.

**2. `signUp()` ne passe PAS d'`emailRedirectTo`** (`AuthContext.tsx`). Le lien de
confirmation retombe donc sur la Site URL — une page web, pas l'app. À corriger
côté code si tu veux que la confirmation ramène dans Mbenguiste.
