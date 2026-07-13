const catchAsync = require('../utils/catchAsync');
const geoService = require('../services/geo.service');

// GET /geo/cities?country=CM&q=dou — country (ISO2) optionnel, q min 2 caractères.
const getCities = catchAsync(async (req, res) => {
  const { country = '', q = '' } = req.query;
  const items = await geoService.searchCities(String(country), String(q));
  res.json({ success: true, data: { items } });
});

module.exports = { getCities };
