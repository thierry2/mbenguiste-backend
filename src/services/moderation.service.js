const ApiError = require('../utils/apiError');
const config = require('../config');
const logger = require('../utils/logger');
const moderationModel = require('../models/moderation.model');
const { idForCode } = require('../models/reference.model');

/**
 * Signalement d'un profil — logique AfrikMoms adaptée au dating :
 *  1. motif OBLIGATOIRE et connu (report_reasons), sinon 400 ;
 *  2. idempotent : un seul dossier ouvert par (signaleur, signalé) — re-signaler
 *     répond succès sans créer de doublon (pas d'arme de spam) ;
 *  3. protection automatique : à N signaleurs DISTINCTS (config), le profil est
 *     retiré de la découverte en attendant revue (réversible : is_discoverable).
 */
async function reportUser(reporterId, reportedId, reasonCode, details) {
  const reasonId = await idForCode('report_reasons', reasonCode);
  if (!reasonId) throw ApiError.badRequest('Motif de signalement invalide.');

  const existing = await moderationModel.findOpenReport(reporterId, reportedId);
  if (existing) return; // déjà transmis — succès silencieux

  await moderationModel.createReport({ reporterId, reportedId, reasonId, details });

  // Seuil de retrait préventif — best-effort : un échec ici ne doit pas faire
  // échouer le signalement lui-même (il est déjà enregistré).
  try {
    const reporters = await moderationModel.countOpenReporters(reportedId);
    if (reporters >= config.limits.reportsAutoHideThreshold) {
      await moderationModel.hideFromDiscovery(reportedId);
      logger.warn(`[moderation] profil ${reportedId} retiré de la découverte (${reporters} signaleurs distincts)`);
    }
  } catch (e) {
    logger.error(`[moderation] seuil auto KO pour ${reportedId} : ${e.message}`);
  }
}

module.exports = { reportUser };
