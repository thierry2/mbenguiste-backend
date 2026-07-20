const app = require('./app');
const config = require('./config');
const { verifyConnection } = require('./config/db');
const logger = require('./utils/logger');
const { purgeExpiredAccounts } = require('./models/profile.model');
const { runScheduledPass } = require('./services/mystere.service');

let server;

async function start() {
  try {
    await verifyConnection();
    logger.info('Supabase joignable');
  } catch (err) {
    logger.warn(
      `Vérification Supabase échouée : ${err.message}. ` +
        'Vérifiez SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY et appliquez db/schema.sql.'
    );
  }

  server = app.listen(config.port, () => {
    logger.info(`Mbenguiste API démarrée sur le port ${config.port} (${config.env})`);
    // Flag de gratuité femmes lu au boot : si Railway n'a pas redéployé après
    // l'ajout de la variable, on verra 'off' ici alors qu'elle est bien posée
    // dans le dashboard — c'est LE signe que le process n'a pas la variable.
    logger.info(`FREE_TIER_WOMEN=${config.freeTierWomen ? 'on' : 'off'}`);
  });

  // Purge des comptes dont la suppression programmée est échue (toutes les minutes).
  // Le délai de grâce laisse à l'utilisateur le temps d'annuler ; passé ce délai,
  // la ligne est anonymisée et deleted_at posé (voir profile.model).
  setInterval(async () => {
    try { await purgeExpiredAccounts(); } catch (e) { logger.warn(`Purge comptes : ${e.message}`); }
  }, 60 * 1000);

  // Passe d'appariement du Mystère : la fonction décide elle-même si c'est le
  // moment (fenêtre de tirage + throttle ~pass_minutes). Un tick par minute, la
  // plupart ne font rien — c'est voulu, ça évite de figer l'heure dans le cron.
  setInterval(async () => {
    try { await runScheduledPass(); } catch (e) { logger.warn(`Passe Mystère : ${e.message}`); }
  }, 60 * 1000);
}

function shutdown(signal) {
  logger.info(`Signal ${signal} reçu, arrêt en cours...`);
  if (server) {
    server.close(() => {
      logger.info('Arrêt terminé');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error(`Rejet non géré : ${reason}`);
});

start();
