const { z } = require('zod');

const swipe = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    action: z.enum(['pass', 'like', 'super_like']),
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
  }),
});

module.exports = { swipe, previewCount };
