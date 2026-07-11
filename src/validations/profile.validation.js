const { z } = require('zod');

const isoCountry = z.string().length(2).toUpperCase();

// Corps commun d'édition de profil (tous les champs optionnels).
const profileBody = z.object({
  prenom: z.string().min(1).max(50).optional(),
  dateNaissance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu AAAA-MM-JJ').optional(),
  genre: z.enum(['woman', 'man']).nullable().optional(),
  bio: z.string().max(500).optional(),
  villeActuelle: z.string().max(80).optional(),
  paysActuel: isoCountry.optional(),
  villeCible: z.string().max(80).optional(),
  paysCible: isoCountry.optional(),
  ouvertAuDepart: z.boolean().optional(),
  objectif: z.enum(['serious', 'marriage', 'friendship', 'unsure']).nullable().optional(),
  languePrincipale: z.string().max(20).optional(),
  langues: z.array(z.string().max(20)).max(10).optional(),
  // Descripteurs mode de vie : {kind: code}. Clés/valeurs courtes, contrôle fin côté DB.
  lifestyle: z.record(z.string().max(40)).optional(),
  interets: z.array(z.string().max(40)).max(10).optional(),
  prompts: z.array(z.object({
    code: z.string().max(60),
    reponse: z.string().min(1).max(200),
  })).max(3).optional(),
});

const updateMe = z.object({ body: profileBody });

const completeOnboarding = z.object({
  body: profileBody.extend({
    // À l'onboarding, quelques champs deviennent requis.
    genre: z.enum(['woman', 'man']),
    dateNaissance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    paysActuel: isoCountry,
    villeActuelle: z.string().min(1).max(80),
  }),
});

const preferences = z.object({
  body: z.object({
    genreRecherche: z.enum(['woman', 'man']).nullable().optional(),
    ageMin: z.number().int().min(18).max(99).optional(),
    ageMax: z.number().int().min(18).max(99).optional(),
    objectifRecherche: z.enum(['serious', 'marriage', 'friendship', 'unsure']).nullable().optional(),
    regions: z.array(z.enum(['africa', 'europe', 'americas'])).max(3).optional(),
    langueCommune: z.boolean().optional(),
    photosMin: z.number().int().min(0).max(6).optional(),
    avecBio: z.boolean().optional(),
    verifiesUniquement: z.boolean().optional(),
  }),
});

module.exports = { updateMe, completeOnboarding, preferences };
