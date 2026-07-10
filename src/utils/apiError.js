/**
 * Erreur applicative avec code HTTP. On la lève dans le code métier ;
 * le middleware d'erreur la traduit en réponse JSON propre.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Requête invalide', details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Non authentifié') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Accès refusé') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Ressource introuvable') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Conflit') {
    return new ApiError(409, msg);
  }
  static tooManyRequests(msg = 'Trop de requêtes') {
    return new ApiError(429, msg);
  }
}

module.exports = ApiError;
