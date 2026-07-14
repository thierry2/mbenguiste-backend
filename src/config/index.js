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

  // Paiements — RevenueCat est la source de vérité ; son webhook reflète l'état
  // dans notre base. Le token protège le webhook (en-tête Authorization partagé,
  // configuré dans le dashboard RC).
  revenuecat: {
    webhookAuthToken: process.env.REVENUECAT_WEBHOOK_AUTH || '',
    entitlementId: process.env.REVENUECAT_ENTITLEMENT || 'or',
  },

  // Autocomplete des villes (proxy GeoNames, gratuit ~20k crédits/jour). Vide →
  // l'autocomplete est désactivé et l'app bascule en saisie libre (jamais bloquant).
  geonames: {
    username: process.env.GEONAMES_USERNAME || '',
  },

  // Quotas gratuits (le carburant du paywall) + durée d'un Boost.
  limits: {
    freeLikesPer12h:        parseInt(process.env.FREE_LIKES_12H, 10)        || 20,
    freeSuperLikesPerDay:   parseInt(process.env.FREE_SUPERLIKES_DAY, 10)   || 1,
    freeTranslationsPerDay: parseInt(process.env.FREE_TRANSLATIONS_DAY, 10) || 10,
    boostDurationMs:        (parseInt(process.env.BOOST_MINUTES, 10) || 30) * 60 * 1000,
    // Réciprocité photos : il faut N photos soi-même pour voir toutes celles des
    // autres (la 1re reste visible). S'applique à TOUT LE MONDE, Or compris.
    photosRequiredToView:   parseInt(process.env.PHOTOS_REQUIRED_VIEW, 10)  || 2,
  },
};

module.exports = config;
