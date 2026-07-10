require('dotenv').config();

/**
 * Configuration centralisée. Toutes les variables d'environnement sont lues
 * ici et nulle part ailleurs.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,

  supabase: {
    // Valeurs « placeholder » : permettent de charger l'app (et les tests) sans
    // vraies credentials. Les requêtes réelles échoueront tant qu'elles ne sont pas définies.
    url: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:8081')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  // Traduction des messages du chat (nouchi, wolof, etc. → langue du lecteur).
  // Vide → l'endpoint renvoie le texte tel quel (fail-open, jamais bloquant).
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  },
};

module.exports = config;
