const crypto = require('crypto');
const supabase = require('../config/supabase');
const config = require('../config');
const ApiError = require('../utils/apiError');

// Comparaison à temps constant : un `===` sur un secret le fuit caractère par
// caractère à qui mesure le temps de réponse. False si l'un est vide ou de
// longueur différente (timingSafeEqual exige des buffers de même taille).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Authentification déléguée à Supabase Auth.
 * Le frontend envoie le token d'accès Supabase (« Authorization: Bearer <token> »).
 * On le valide et on attache l'utilisateur à req.user.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Token manquant ou mal formé');
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      throw ApiError.unauthorized('Token invalide ou expiré');
    }

    const userId = data.user.id;

    // Compte en cours de suppression (soft delete) → 403.
    const { data: profile } = await supabase
      .from('profiles')
      .select('deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.deleted_at) {
      throw ApiError.forbidden('Ce compte a été supprimé');
    }

    req.user = {
      id: userId,
      email: data.user.email,
      emailConfirmedAt: data.user.email_confirmed_at ?? null,
      role: data.user.role,
      user_metadata: data.user.user_metadata ?? {},
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Console de modération. Deux clés acceptées, dans cet ordre :
 *   1. `Authorization: Bearer <jeton>` — jeton de session court, obtenu une fois
 *      contre le secret (voie normale : le secret ne séjourne plus dans le
 *      navigateur) ;
 *   2. `x-admin-secret` — le secret direct, conservé pour ne verrouiller
 *      personne dehors (scripts, curl, ancienne page en cache).
 *
 * + allowlist IP optionnelle et VERROU par IP après échecs répétés. Sans
 * ADMIN_SECRET défini, TOUT est refusé — un secret vide ne doit jamais ouvrir
 * une console qui lit des récits d'agressions.
 * `req.ip` reflète le vrai client car `trust proxy` est actif (Railway).
 */
function requireAdmin(req, res, next) {
  const adminAuth = require('../services/adminAuth.service');

  if (config.admin.allowedIps.length && !config.admin.allowedIps.includes(req.ip)) {
    adminAuth.audit(req, 'admin.denied.ip');
    return next(ApiError.unauthorized('Accès admin refusé'));
  }

  const { locked, remainingMs } = adminAuth.lockState(req.ip);
  if (locked) {
    adminAuth.audit(req, 'admin.denied.locked');
    return next(ApiError.unauthorized(
      `Trop de tentatives. Réessaie dans ${Math.ceil(remainingMs / 60000)} min.`,
    ));
  }

  if (!config.admin.secret) return next(ApiError.unauthorized('Accès admin refusé'));

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const parJeton = bearer && adminAuth.verifyToken(bearer);
  const parSecret = safeEqual(req.headers['x-admin-secret'], config.admin.secret);

  if (!parJeton && !parSecret) {
    adminAuth.registerFailure(req.ip);
    adminAuth.audit(req, 'admin.denied.badkey');
    return next(ApiError.unauthorized('Accès admin refusé'));
  }

  adminAuth.registerSuccess(req.ip);
  next();
}

/**
 * Portail partenaire : après `authenticate` (jeton Supabase), le compte doit
 * correspondre à un partenaire. Charge le partenaire dans req.partner ; 403 si
 * le compte n'est pas partenaire ou s'il est suspendu (frozen).
 */
async function requirePartner(req, res, next) {
  try {
    const partnersModel = require('../models/partners.model');
    const partner = await partnersModel.findByAuthUser(req.user.id);
    if (!partner) throw ApiError.forbidden('Accès partenaire refusé');
    if (partner.status === 'frozen') throw ApiError.forbidden('Compte partenaire suspendu');
    req.partner = partner;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, requireAdmin, requirePartner };
