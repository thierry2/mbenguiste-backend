const app = require('./app');
const config = require('./config');
const { verifyConnection } = require('./config/db');
const logger = require('./utils/logger');

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
