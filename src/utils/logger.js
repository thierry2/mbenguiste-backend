/** Logger minimaliste sans dépendance. Remplaçable par pino/winston plus tard. */
function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (msg) => console.log(`[${timestamp()}] INFO  ${msg}`),
  warn: (msg) => console.warn(`[${timestamp()}] WARN  ${msg}`),
  error: (msg) => console.error(`[${timestamp()}] ERROR ${msg}`),
  debug: (msg) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[${timestamp()}] DEBUG ${msg}`);
    }
  },
};

module.exports = logger;
