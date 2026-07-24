const { z } = require('zod');

const swipe = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    action: z.enum(['pass', 'like', 'super_like']),
    // Like ciblé (« aimer ce détail ») — optionnel, ignoré sur un pass.
    // `type`/`ref` sont facultatifs : un mot envoyé depuis le DECK (mot avant
    // match, Prestige) ne vise aucune photo précise — c'est un mot tout court.
    // seedOpeners sait déjà rendre ce cas (« ❤ {mot} », sans contexte).
    cible: z.object({
      type: z.enum(['photo', 'prompt']).nullable().optional(),
      ref: z.string().max(120).nullable().optional(),
      comment: z.string().max(200).nullable().optional(),
    }).nullable().optional(),
  }),
});

// Liker un Coup de cœur du jour : pas d'action (toujours un like), juste la
// cible optionnelle (« aimer ce détail »).
const pickLike = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    cible: z.object({
      type: z.enum(['photo', 'prompt']),
      ref: z.string().max(120),
      comment: z.string().max(200).nullable().optional(),
    }).nullable().optional(),
  }),
});

// Aperçu live du compteur : mêmes champs que les préférences, tous optionnels
// (état en cours d'édition, pas encore enregistré). Miroir de la validation
// `preferences` de profile.validation.js.
const previewCount = z.object({
  body: z.object({
    genreRecherche: z.enum(['woman', 'man']).nullable().optional(),
    ageMin: z.number().int().min(18).max(99).optional(),
    ageMax: z.number().int().min(18).max(99).optional(),
    objectifRecherche: z.enum(['serious', 'marriage', 'friendship', 'unsure']).nullable().optional(),
    paysRecherche: z.string().length(2).toUpperCase().nullable().optional(),
    rayonKm: z.number().int().min(1).max(500).nullable().optional(),
    langueCommune: z.boolean().optional(),
    photosMin: z.number().int().min(0).max(6).optional(),
    avecBio: z.boolean().optional(),
    verifiesUniquement: z.boolean().optional(),
    origineRecherche: z.string().length(2).toUpperCase().nullable().optional(),
    tailleMin: z.number().int().min(100).max(250).nullable().optional(),
    tailleMax: z.number().int().min(100).max(250).nullable().optional(),
    interetsCommuns: z.boolean().optional(),
    lifestyleFiltres: z.record(z.string().max(40), z.array(z.string().max(40)).max(12)).optional(),
    // ⚠ TOUT champ absent d'ici est RETIRÉ par zod, EN SILENCE. Ces quatre-là
    // changent le RÉSULTAT du comptage : les oublier faisait compter le serveur
    // sans eux pendant que le deck les appliquait — un compteur qui ment, ce que
    // ce code s'interdit explicitement. Ce schéma doit suivre `construirePayload`
    // (frontend/src/lib/prefsPayload.ts) champ pour champ.
    ancreLat: z.number().min(-90).max(90).nullable().optional(),
    ancreLng: z.number().min(-180).max(180).nullable().optional(),
    ancreLabel: z.string().max(80).nullable().optional(),
    elargirSiVide: z.boolean().optional(),
  }),
});

module.exports = { swipe, pickLike, previewCount };
