const catchAsync = require('../utils/catchAsync');
const eventsService = require('../services/events.service');

/**
 * Ingestion d'un batch de télémétrie (sondes deck/profil). Répond vite et ne
 * bloque jamais l'UI : les événements irrécupérables sont nettoyés en silence,
 * `accepted` dit combien étaient NOUVEAUX (un retry du même batch renvoie 0).
 */
const postEvents = catchAsync(async (req, res) => {
  const { accepted } = await eventsService.ingest(req.user.id, req.body.events);
  res.json({ success: true, data: { accepted } });
});

module.exports = { postEvents };
