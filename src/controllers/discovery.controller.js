const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const discoveryModel = require('../models/discovery.model');
const swipeModel = require('../models/swipe.model');

/** File de profils à découvrir. */
const getCandidates = catchAsync(async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
  const profils = await discoveryModel.candidates(req.user.id, { limit });
  res.json({ success: true, data: { profils } });
});

/**
 * Enregistre un swipe. body: { action: 'pass'|'like'|'super_like' }.
 * Renvoie le match éventuel (like réciproque) pour déclencher l'écran « C'est réciproque ».
 */
const swipe = catchAsync(async (req, res) => {
  const { action } = req.body;
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se swiper soi-même');

  const { match } = await swipeModel.record(req.user.id, targetId, action);
  res.json({ success: true, data: { match } });
});

module.exports = { getCandidates, swipe };
