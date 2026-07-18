const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const moderationModel = require('../models/moderation.model');
const moderationService = require('../services/moderation.service');
const safetyService = require('../services/safety.service');

const blockUser = catchAsync(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('Impossible de se bloquer soi-même');
  await moderationModel.block(req.user.id, req.params.id);
  res.json({ success: true });
});

const unblockUser = catchAsync(async (req, res) => {
  await moderationModel.unblock(req.user.id, req.params.id);
  res.json({ success: true });
});

const listBlocked = catchAsync(async (req, res) => {
  const blocked = await moderationModel.listBlocked(req.user.id);
  res.json({ success: true, data: { blocked } });
});

const reportUser = catchAsync(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('Impossible de se signaler soi-même');
  const { reason, details } = req.body;
  await moderationService.reportUser(req.user.id, req.params.id, reason, details);
  res.json({ success: true });
});

/** Centre de sécurité : conversations en cours + anciennes connexions (matchs
 *  défaits, blocages) — pour signaler même une personne disparue des matchs. */
const pastConnections = catchAsync(async (req, res) => {
  const data = await safetyService.pastConnections(req.user.id);
  res.json({ success: true, data });
});

/** Dossier libre : la personne n'apparaît dans aucune connexion. */
const reportFreeform = catchAsync(async (req, res) => {
  await safetyService.reportFreeform(req.user.id, req.body.body);
  res.json({ success: true });
});

module.exports = { blockUser, unblockUser, listBlocked, reportUser, pastConnections, reportFreeform };
