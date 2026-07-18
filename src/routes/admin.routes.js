const express = require('express');
const adminService = require('../services/adminModeration.service');
const adminModel = require('../models/adminModeration.model');
const partnerAdminService = require('../services/partnerAdmin.service');
const partnersModel = require('../models/partners.model');
const partnerStats = require('../models/partnerStats.model');
const { requireAdmin } = require('../middlewares/auth.middleware');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');

const router = express.Router();

// Toutes les routes admin exigent le secret partagé (en-tête x-admin-secret).
router.use(requireAdmin);

const ACTIONS = ['retirer', 'restaurer', 'rejeter'];

// GET /api/v1/admin/moderation/counts — file d'attente réelle (bandeau console)
router.get('/moderation/counts', catchAsync(async (_req, res) => {
  res.json({ success: true, data: await adminModel.counts() });
}));

// GET /api/v1/admin/moderation/dossiers?status=open|closed|all
// Un dossier PAR PERSONNE signalée, trié par gravité puis nombre de signalantes.
router.get('/moderation/dossiers', catchAsync(async (req, res) => {
  const dossiers = await adminService.listDossiers(req.query.status ?? 'open');
  res.json({ success: true, data: { dossiers } });
}));

// POST /api/v1/admin/moderation/dossiers/:profileId  body: { action, note? }
// Clôt TOUS les signalements ouverts de la personne en un geste.
router.post('/moderation/dossiers/:profileId', catchAsync(async (req, res) => {
  const { action, note } = req.body ?? {};
  if (!ACTIONS.includes(action)) {
    throw ApiError.badRequest(`Action invalide. Valeurs acceptées : ${ACTIONS.join(', ')}`);
  }
  const result = await adminService.traiterDossier(req.params.profileId, { action, note });
  res.json({ success: true, data: result });
}));

// GET /api/v1/admin/moderation/dossiers-libres?status=open|closed|all
router.get('/moderation/dossiers-libres', catchAsync(async (req, res) => {
  const dossiers = await adminService.listFreeform(req.query.status ?? 'open');
  res.json({ success: true, data: { dossiers } });
}));

// POST /api/v1/admin/moderation/dossiers-libres/:id  body: { action, note? }
router.post('/moderation/dossiers-libres/:id', catchAsync(async (req, res) => {
  const { action, note } = req.body ?? {};
  if (!ACTIONS.includes(action)) {
    throw ApiError.badRequest(`Action invalide. Valeurs acceptées : ${ACTIONS.join(', ')}`);
  }
  const result = await adminService.traiterDossierLibre(req.params.id, { action, note });
  res.json({ success: true, data: result });
}));

// ── Programme Partenaires ────────────────────────────────────────────────────

const PARTNER_STATUSES = ['invited', 'active', 'frozen'];

// GET /api/v1/admin/partners — liste des partenaires (+ code).
router.get('/partners', catchAsync(async (_req, res) => {
  res.json({ success: true, data: { partners: await partnersModel.list() } });
}));

// POST /api/v1/admin/partners  body: { displayName, email, code?, isFounder?, rateBps?, redirectTo? }
router.post('/partners', catchAsync(async (req, res) => {
  const { displayName, email, code, isFounder, rateBps, redirectTo } = req.body ?? {};
  if (!displayName || !email) throw ApiError.badRequest('displayName et email sont requis');
  if (rateBps != null && (rateBps < 0 || rateBps > 10000)) throw ApiError.badRequest('rateBps hors bornes (0..10000)');
  const result = await partnerAdminService.createAndInvite({ displayName, email, code, isFounder, rateBps, redirectTo });
  res.status(201).json({ success: true, data: result });
}));

// PATCH /api/v1/admin/partners/:id  body: { status }
router.patch('/partners/:id', catchAsync(async (req, res) => {
  const { status } = req.body ?? {};
  if (!PARTNER_STATUSES.includes(status)) {
    throw ApiError.badRequest(`Statut invalide. Valeurs : ${PARTNER_STATUSES.join(', ')}`);
  }
  await partnersModel.setStatus(req.params.id, status);
  res.json({ success: true, data: { status } });
}));

// POST /api/v1/admin/partners/:id/payout  body: { method?, reference?, currency? }
// Verse (à la main) toutes les commissions payables (validées / hold écoulé).
router.post('/partners/:id/payout', catchAsync(async (req, res) => {
  const { method, reference, currency } = req.body ?? {};
  const result = await partnerStats.recordPayout(req.params.id, { method, reference, currency });
  res.json({ success: true, data: result });
}));

module.exports = router;
