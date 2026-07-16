const { z } = require('zod');

const send = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    texte: z.string().min(1).max(2000),
    // La langue cible de la traduction n'est PAS reçue du client : le serveur la
    // lit sur le profil du destinataire (cf. message.controller). Un champ ici
    // serait falsifiable, et l'outbox oubliait justement de l'envoyer.
  }),
});

module.exports = { send };
