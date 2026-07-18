const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middlewares/error.middleware');

const app = express();

// Derrière le reverse proxy Railway.
app.set('trust proxy', 1);

// ── Pages web servies par CE service (même backend) ──────────────────────────
// Le portail partenaire (/partenaires) et la console admin (/admin). Montés
// AVANT helmet : ces pages embarquent styles/scripts inline + Supabase Auth, que
// la CSP par défaut de helmet casserait. En-têtes de discrétion posés à la main.
const WEB_DIR = path.join(__dirname, '..', 'web');
function pageHeaders(_req, res, next) {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
}
// Config publique du portail (URL + clé anon Supabase) pour l'auth côté navigateur.
app.get('/partenaires/config.json', pageHeaders, (_req, res) => {
  res.json({ supabaseUrl: config.supabase.url, supabaseAnonKey: config.supabase.anonKey });
});
// `redirect: false` : sans ça, /partenaires renvoie un 301 vers /partenaires/
// (redirection de dossier) au lieu d'être servi directement par le repli.
const staticOpts = { redirect: false };
app.use('/partenaires', pageHeaders, express.static(path.join(WEB_DIR, 'portal'), staticOpts));
app.use('/admin', pageHeaders, express.static(path.join(WEB_DIR, 'admin'), staticOpts));

// Chemins EXACTS seulement : un sous-chemin inventé (/admin/nimporte-quoi) doit
// tomber en 404, pas servir la console. Le retour d'auth Supabase arrive sur
// /partenaires avec un fragment (#access_token), jamais un sous-chemin.
app.get(['/partenaires', '/partenaires/'], pageHeaders, (_req, res) =>
  res.sendFile(path.join(WEB_DIR, 'portal', 'index.html')));
app.get(['/admin', '/admin/'], pageHeaders, (_req, res) =>
  res.sendFile(path.join(WEB_DIR, 'admin', 'index.html')));

app.use(helmet());
app.use(cors({ origin: config.cors.origins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (config.env !== 'test') {
  app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));
}

// Limitation de débit globale. On ne compte pas le polling de badges (unread-count)
// ni le healthcheck, sinon une session active épuise le quota.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path.endsWith('/unread-count'),
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
