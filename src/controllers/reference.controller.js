const catchAsync = require('../utils/catchAsync');
const referenceModel = require('../models/reference.model');

/** Listes de référence pour l'onboarding et les filtres (genres, objectifs, intérêts…). */
const bootstrap = catchAsync(async (req, res) => {
  const data = await referenceModel.bootstrap();
  res.json({ success: true, data });
});

module.exports = { bootstrap };
