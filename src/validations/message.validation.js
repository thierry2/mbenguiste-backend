const { z } = require('zod');

const send = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    texte: z.string().min(1).max(2000),
    // Langue du lecteur (destinataire) pour la traduction éventuelle.
    langueLecteur: z.string().max(20).optional(),
  }),
});

module.exports = { send };
