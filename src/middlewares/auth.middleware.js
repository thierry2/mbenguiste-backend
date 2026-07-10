const supabase = require('../config/supabase');
const ApiError = require('../utils/apiError');

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

module.exports = { authenticate };
