const catchAsync = require('../utils/catchAsync');
const config = require('../config');
const billingService = require('../services/billing.service');

/**
 * Webhook RevenueCat (serveur-à-serveur). Protégé par un en-tête Authorization
 * partagé, configuré dans le dashboard RC. Toujours répondre 200 vite : RC réessaie
 * sinon, et notre traitement est idempotent.
 */
const revenuecat = catchAsync(async (req, res) => {
  const token = config.revenuecat.webhookAuthToken;
  if (token) {
    const got = req.get('authorization') || '';
    if (got !== token && got !== `Bearer ${token}`) {
      return res.status(401).json({ success: false, error: 'unauthorized' });
    }
  }
  await billingService.handleEvent(req.body && req.body.event);
  res.json({ success: true });
});

module.exports = { revenuecat };
