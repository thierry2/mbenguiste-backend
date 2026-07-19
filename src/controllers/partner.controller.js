const catchAsync = require('../utils/catchAsync');
const stats = require('../models/partnerStats.model');
const { summarizeBalance, sumSince, dailySeries } = require('../domain/partnerStats');

/** Identité + code du partenaire connecté (portail). */
const me = catchAsync(async (req, res) => {
  const p = req.partner;
  res.json({
    success: true,
    data: {
      partner: {
        displayName: p.displayName, email: p.email, code: p.code,
        rateBps: p.rateBps, isFounder: p.isFounder, status: p.status,
      },
    },
  });
});

/** Les 4 KPI + le solde (en attente / validé / versé). */
const getStats = catchAsync(async (req, res) => {
  const partnerId = req.partner.id;
  const rows = await stats.ledgerRows(partnerId);

  const now = new Date();
  const balance = summarizeBalance(rows, now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthCents = sumSince(rows, monthStart);

  const [signups, activeSubscribers] = await Promise.all([
    stats.signupsCount(partnerId),
    stats.activeSubscribersCount(partnerId),
  ]);

  // Série pour la courbe + variation sur la période (ce que la courbe raconte).
  const series = dailySeries(rows, { days: 30, now });
  const moitie = Math.floor(series.length / 2);
  const debut = series.slice(0, moitie).reduce((s, p) => s + p.cents, 0);
  const recent = series.slice(moitie).reduce((s, p) => s + p.cents, 0);
  const trendPct = debut > 0 ? Math.round(((recent - debut) / debut) * 100) : null;

  res.json({
    success: true,
    data: { signups, activeSubscribers, monthCents, balance, series, trendPct },
  });
});

/** Derniers abonnés référés (identités masquées). */
const getReferrals = catchAsync(async (req, res) => {
  res.json({ success: true, data: { referrals: await stats.recentReferrals(req.partner.id) } });
});

/** Historique des versements. */
const getPayouts = catchAsync(async (req, res) => {
  res.json({ success: true, data: { payouts: await stats.payouts(req.partner.id) } });
});

module.exports = { me, getStats, getReferrals, getPayouts };
