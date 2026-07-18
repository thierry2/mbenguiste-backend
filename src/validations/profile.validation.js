const { z } = require('zod');
const { REPORT_DETAILS_MAX, FREEFORM_MIN, FREEFORM_MAX } = require('../constants/safety');

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
  intention: z.enum(['depart', 'return', 'any']).nullable().optional(),
  objectif: z.enum(['serious', 'marriage', 'friendship', 'unsure']).nullable().optional(),
  // Carte d'identité — descripteurs de la vitrine.
  taille: z.number().int().min(100).max(250).nullable().optional(),   // cm
  origine: isoCountry.nullable().optional(),                          // pays d'origine (ISO alpha-2)
  metier: z.string().max(60).nullable().optional(),
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
    paysRecherche: isoCountry.nullable().optional(),        // ISO alpha-2, null = partout
    rayonKm: z.number().int().min(1).max(500).nullable().optional(),
    langueCommune: z.boolean().optional(),
    photosMin: z.number().int().min(0).max(6).optional(),
    avecBio: z.boolean().optional(),
    verifiesUniquement: z.boolean().optional(),
    // v2 (migration 015) : ce qu'on renseigne au profil devient filtrable.
    origineRecherche: isoCountry.nullable().optional(),   // pays d'ORIGINE, pas de résidence
    tailleMin: z.number().int().min(100).max(250).nullable().optional(),
    tailleMax: z.number().int().min(100).max(250).nullable().optional(),
    interetsCommuns: z.boolean().optional(),
    lifestyleFiltres: z.record(z.string().max(40), z.array(z.string().max(40)).max(12)).optional(),
  }),
});

/** Mise à jour de la position (captée par expo-location). */
const location = z.object({
  body: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
});

/** Signalement d'un profil : motif obligatoire (code report_reasons) + récit.
 *  2000 caractères comme le dossier libre et comme l'écran : depuis le centre de
 *  sécurité, le récit d'une rencontre en personne est la SEULE trace que l'app
 *  n'a pas — le borner à 1000 coupait des dossiers en plein milieu. */
const report = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().min(1).max(40),
    details: z.string().max(REPORT_DETAILS_MAX).optional(),
  }),
});

/** Dossier libre (centre de sécurité) : assez de texte pour que l'équipe puisse
 *  retrouver le profil (20 min), borné comme la contrainte DB (2000 max). */
const freeformReport = z.object({
  body: z.object({
    body: z.string().trim().min(FREEFORM_MIN).max(FREEFORM_MAX),
  }),
});

module.exports = { updateMe, completeOnboarding, preferences, location, report, freeformReport };
