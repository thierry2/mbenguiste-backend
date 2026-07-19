const express = require('express');
const adminService = require('../services/adminModeration.service');
const adminModel = require('../models/adminModeration.model');
const partnerAdminService = require('../services/partnerAdmin.service');
const partnersModel = require('../models/partners.model');
const partnerStats = require('../models/partnerStats.model');
const { requireAdmin } = require('../middlewares/auth.middleware');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');

const rateLimit = require('express-rate-limit');
const adminAuth = require('../services/adminAuth.service');
const config = require('../config');

const router = express.Router();

// ── Ouverture de session : le SEUL endroit où le secret circule ──────────────
// Limité serré : c'est la porte que l'on tenterait de forcer.
const sessionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessaie plus tard.' },
});

// POST /api/v1/admin/session  body: { secret } → { token, expiresIn }
// Échange le secret contre un jeton court. Le navigateur ne conserve QUE le jeton.
router.post('/session', sessionLimiter, catchAsync(async (req, res) => {
  const { locked, remainingMs } = adminAuth.lockState(req.ip);
  if (locked) {
    adminAuth.audit(req, 'admin.session.locked');
    throw ApiError.unauthorized(`Trop de tentatives. Réessaie dans ${Math.ceil(remainingMs / 60000)} min.`);
  }
  if (config.admin.allowedIps.length && !config.admin.allowedIps.includes(req.ip)) {
    adminAuth.audit(req, 'admin.session.denied.ip');
    throw ApiError.unauthorized('Accès admin refusé');
  }

  const secret = (req.body || {}).secret || '';
  const token = config.admin.secret
    && secret.length === config.admin.secret.length
    && require('crypto').timingSafeEqual(Buffer.from(secret), Buffer.from(config.admin.secret))
    ? adminAuth.issueToken()
    : null;

  if (!token) {
    const st = adminAuth.registerFailure(req.ip);
    adminAuth.audit(req, 'admin.session.failed');
    throw ApiError.unauthorized(st.locked
      ? `Trop de tentatives. Réessaie dans ${Math.ceil(st.remainingMs / 60000)} min.`
      : 'Secret refusé');
  }

  adminAuth.registerSuccess(req.ip);
  adminAuth.audit(req, 'admin.session.opened');
  res.json({ success: true, data: { token, expiresIn: adminAuth.TTL_MS } });
}));

// Toutes les routes ci-dessous exigent le jeton de session (ou le secret direct).
router.use(requireAdmin);

// Toute action admin qui MODIFIE quelque chose laisse une trace.
router.use((req, _res, next) => {
  if (req.method !== 'GET') adminAuth.audit(req, `admin.${req.method} ${req.path}`);
  next();
});

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

// POST /api/v1/admin/partners  body: { displayName, email, code?, isFounder?, rateBps? }
// L'URL de retour du lien d'invitation n'est PAS acceptée du client : elle vient
// de PUBLIC_BASE_URL côté serveur (cf. partnerAdmin.service).
router.post('/partners', catchAsync(async (req, res) => {
  const { displayName, email, code, isFounder, rateBps } = req.body ?? {};
  if (!displayName || !email) throw ApiError.badRequest('displayName et email sont requis');
  if (rateBps != null && (rateBps < 0 || rateBps > 10000)) throw ApiError.badRequest('rateBps hors bornes (0..10000)');
  const result = await partnerAdminService.createAndInvite({ displayName, email, code, isFounder, rateBps });
  res.status(201).json({ success: true, data: result });
}));

// POST /api/v1/admin/partners/:id/invite
// Relance l'invitation (email non reçu, lien expiré). L'erreur Supabase est
// remontée telle quelle : c'est la seule façon de savoir pourquoi ça ne part pas.
// La réponse renvoie aussi l'URL de retour utilisée, pour la vérifier d'un coup d'œil.
router.post('/partners/:id/invite', catchAsync(async (req, res) => {
  const result = await partnerAdminService.reinvite(req.params.id);
  res.json({ success: true, data: result });
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
