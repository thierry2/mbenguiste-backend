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
    // Clé anon (PUBLIQUE) — servie au portail partenaire pour Supabase Auth côté navigateur.
    anonKey: process.env.SUPABASE_ANON_KEY || '',
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

  // Gratuité femmes au lancement (doctrine §3) : quand ce flag est actif, une
  // femme reçoit l'Or offert MOINS la révélation (calculé à la volée par
  // access.service, JAMAIS écrit en base → désactivation instantanée et indolore).
  // `.trim().toLowerCase()` : un copier-coller dans Railway laisse facilement une
  // espace ou un retour ligne invisibles ('on ' !== 'on') — le piège classique
  // qui laisse le flag « posé » côté dashboard mais inactif dans le process.
  freeTierWomen: (process.env.FREE_TIER_WOMEN || '').trim().toLowerCase() === 'on',

  // Quotas gratuits (le carburant du paywall) + durée d'un Boost.
  limits: {
    freeLikesPer12h:        parseInt(process.env.FREE_LIKES_12H, 10)        || 20,
    // 0 : le Super Like n'a AUCUN quota gratuit quotidien (décision 18/07). Le
    // « 1 gratuit / jour » qu'on lui prêtait par erreur, c'est le COUP DE CŒUR
    // (freePicksLikesPerDay ci-dessous). Un Super Like s'obtient par achat (packs)
    // ou par le grant Or PAYÉ (5/sem) — jamais offert, jamais quotidien gratuit.
    freeSuperLikesPerDay:   parseInt(process.env.FREE_SUPERLIKES_DAY, 10)   || 0,
    // 0 : la traduction est un avantage OR, jamais offert (chaque message traduit
    // = un appel Gemini facturé). Mettre >0 rouvrirait un quota d'essai gratuit.
    freeTranslationsPerDay: parseInt(process.env.FREE_TRANSLATIONS_DAY, 10) || 0,
    freePicksLikesPerDay:   parseInt(process.env.FREE_PICKS_LIKES_DAY, 10)  || 1,
    boostDurationMs:        (parseInt(process.env.BOOST_MINUTES, 10) || 30) * 60 * 1000,
    // Réciprocité photos : il faut N photos soi-même pour voir toutes celles des
    // autres (la 1re reste visible). S'applique à TOUT LE MONDE, Or compris.
    photosRequiredToView:   parseInt(process.env.PHOTOS_REQUIRED_VIEW, 10)  || 2,
    // Signalements : à N signaleurs DISTINCTS avec un dossier ouvert, le profil
    // est retiré de la découverte en attendant revue (protection automatique).
    reportsAutoHideThreshold: parseInt(process.env.REPORTS_AUTO_HIDE, 10)   || 3,
  },

  // Suppression de compte : délai de grâce avant la purge définitive. Tant que
  // la purge n'a pas tourné, l'utilisateur peut annuler et retrouver son compte
  // intact (exigence stores + RGPD : une fenêtre d'annulation claire, jamais un
  // effacement immédiat et irréversible).
  accountDeletionDelayMs:
    (parseInt(process.env.ACCOUNT_DELETION_DELAY_DAYS, 10) || 30) * 24 * 60 * 60 * 1000,

  // Console de modération. Secret partagé + allowlist IP optionnelle (vide = le
  // secret seul). Sans ADMIN_SECRET, les routes /admin restent toutes fermées.
  admin: {
    secret: process.env.ADMIN_SECRET || '',
    allowedIps: (process.env.ADMIN_ALLOWED_IPS || '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  },
};

module.exports = config;
