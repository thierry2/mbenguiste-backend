const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');

const NOT_FOUND_PAGE = path.join(__dirname, '..', '..', 'web', '404.html');

/**
 * Le service sert à la fois une API JSON et des pages web (/partenaires, /admin).
 * Un NAVIGATEUR qui se trompe d'URL ne doit pas recevoir du JSON brut.
 *
 * On ne se fie pas à `req.accepts()` : un `fetch()` envoie `Accept: *​/*`, qui
 * matcherait 'html' et renverrait une page à du code qui attend du JSON. On exige
 * donc `text/html` EXPLICITE (ce que fait une navigation), et jamais sous /api/.
 */
function isBrowserNavigation(req) {
  if (req.originalUrl.startsWith('/api/')) return false;
  return String(req.headers.accept || '').includes('text/html');
}

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

  // Navigation navigateur : page HTML plutôt que JSON.
  if (isBrowserNavigation(req)) {
    // Lien protégé atteint sans droits → on renvoie vers la porte d'entrée
    // plutôt que d'afficher une erreur sèche.
    if (statusCode === 401 || statusCode === 403) return res.redirect('/partenaires');
    if (statusCode === 404) return res.status(404).sendFile(NOT_FOUND_PAGE);
  }

  res.status(statusCode).json({
    success: false,
    message: message || 'Erreur interne du serveur',
    ...(err.details ? { details: err.details } : {}),
    ...(config.env === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
