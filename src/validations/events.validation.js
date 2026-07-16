const { z } = require('zod');

// Batch de télémétrie des sondes UI (deck + profil consulté). Le zod borne les
// FORMES (kinds fermés, uuid, batch ≤ 50, dwell ≤ 30 min) ; le service applique
// le reste (self-target jeté, payload borné en taille). Le client envoie par
// lots depuis l'eventOutbox — jamais un événement à la fois.
const batch = z.object({
  body: z.object({
    events: z.array(z.object({
      kind: z.enum(['card_impression', 'profile_open', 'profile_section_view', 'profile_photo_view']),
      targetId: z.string().uuid(),
      // Idempotence des retries : généré côté client à la CRÉATION de l'événement.
      clientRef: z.string().min(8).max(64),
      dwellMs: z.number().min(0).max(1_800_000).optional(),
      payload: z.record(z.string().max(40), z.any()).optional(),
    })).min(1).max(50),
  }),
});

module.exports = { batch };
