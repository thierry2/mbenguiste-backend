const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const matchModel = require('../models/match.model');

const list = catchAsync(async (req, res) => {
  const matchs = await matchModel.listForUser(req.user.id);
  res.json({ success: true, data: { matchs } });
});

const getOne = catchAsync(async (req, res) => {
  const match = await matchModel.getForUser(req.params.id, req.user.id);
  if (!match) throw ApiError.notFound('Match introuvable');
  res.json({ success: true, data: { match } });
});

const unmatch = catchAsync(async (req, res) => {
  const ok = await matchModel.unmatch(req.params.id, req.user.id);
  if (!ok) throw ApiError.notFound('Match introuvable');
  res.json({ success: true });
});

module.exports = { list, getOne, unmatch };
