const config = require('../config');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

/** Route inexistante → 404 propre. */
function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route introuvable : ${req.method} ${req.originalUrl}`));
}

/* eslint-disable no-unused-vars */
/** Gestionnaire d'erreurs central (signature à 4 args obligatoire pour Express). */
function errorHandler(err, req, res, next) {
  let { statusCode, message } = err;

  if (err.message === 'Request aborted' || err.code === 'ECONNRESET' || req.aborted) {
    logger.warn(`${req.method} ${req.originalUrl} → connexion interrompue par le client`);
    return;
  }

  // Erreurs multer (upload) : la limite de taille lève une MulterError sans
  // statusCode → sans ça elle finirait en 500.
  if (err.name === 'MulterError') {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux' : 'Envoi de fichier invalide';
  }

  // Codes PostgreSQL (remontés par Supabase) → codes HTTP lisibles.
  switch (err.code) {
    case '23505': // unique_violation
      statusCode = 409;
      message = 'Cette valeur est déjà utilisée';
      break;
    case '23503': // foreign_key_violation
      statusCode = 400;
      message = 'Référence invalide vers une ressource inexistante';
      break;
    case '23502': // not_null_violation
      statusCode = 400;
      message = 'Champ obligatoire manquant';
      break;
    case '22P02': // invalid_text_representation (UUID mal formé, etc.)
      statusCode = 400;
      message = 'Format de donnée invalide';
      break;
    default:
      break;
  }

  statusCode = statusCode || 500;
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} → ${err.stack || err.message}`);
  }

  res.status(statusCode).json({
    success: false,
    message: message || 'Erreur interne du serveur',
    ...(err.details ? { details: err.details } : {}),
    ...(config.env === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
