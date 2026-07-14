const { z } = require('zod');

const swipe = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    action: z.enum(['pass', 'like', 'super_like']),
    // Like ciblé (« aimer ce détail ») — optionnel, ignoré sur un pass.
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
  }),
});

module.exports = { swipe, previewCount };
