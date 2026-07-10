const supabase = require('./supabase');

/**
 * Supabase est interrogé via une API REST stateless : pas de connexion
 * persistante à ouvrir. On vérifie juste la disponibilité au démarrage.
 */
async function verifyConnection() {
  const { error } = await supabase
    .from('profiles')
    .select('id', { head: true, count: 'exact' });
  if (error) throw error;
}

module.exports = { verifyConnection };
