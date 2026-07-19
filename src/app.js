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
// Portail partenaire (/partenaires) et console admin (/admin). Montés AVANT
// helmet pour leur appliquer une CSP SUR MESURE, plus stricte que la générique :
// aucun style ni script inline (tout est en fichiers), aucun CDN (supabase-js est
// rapatrié dans web/vendor). Seule sortie réseau autorisée : notre Supabase.
const WEB_DIR = path.join(__dirname, '..', 'web');

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",   // pas d'iframe : anti-clickjacking
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",         // zéro style inline
  "script-src 'self'",        // zéro script inline, zéro CDN
  `connect-src 'self' ${config.supabase.url}`,
].join('; ');

function pageHeaders(_req, res, next) {
  res.set('Content-Security-Policy', CSP);
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

// Config publique du portail (URL + clé anon Supabase) pour l'auth côté navigateur.
app.get('/partenaires/config.json', pageHeaders, (_req, res) => {
  res.json({ supabaseUrl: config.supabase.url, supabaseAnonKey: config.supabase.anonKey });
});

// Ressources partagées : thème CSS et supabase-js rapatrié (aucun CDN externe).
// `maxAge: 0` + ETag : le navigateur REVALIDE à chaque visite (réponses 304,
// donc quasi gratuites) au lieu de garder une version figée. Sans ça, une
// correction déployée resterait invisible pendant toute la durée du cache —
// exactement le piège rencontré en développant ces pages.
const staticOpts = { redirect: false, maxAge: 0, etag: true };
app.use('/assets', pageHeaders, express.static(path.join(WEB_DIR, 'assets'), staticOpts));
app.use('/vendor', pageHeaders, express.static(path.join(WEB_DIR, 'vendor'), staticOpts));
app.use('/partenaires', pageHeaders, express.static(path.join(WEB_DIR, 'portal'), staticOpts));
app.use('/admin', pageHeaders, express.static(path.join(WEB_DIR, 'admin'), staticOpts));

// Chemins EXACTS seulement : un sous-chemin inventé tombe en 404 plutôt que de
// servir la console. Les écrans d'authentification du portail ont chacun leur
// URL (le retour Supabase arrive sur /partenaires, avec fragment ou ?code).
const PORTAL_PATHS = [
  '/partenaires', '/partenaires/',
  '/partenaires/connexion',
  '/partenaires/lien-magique',
  '/partenaires/mot-de-passe-oublie',
  '/partenaires/nouveau-mot-de-passe',
];
app.get(PORTAL_PATHS, pageHeaders, (_req, res) =>
  res.sendFile(path.join(WEB_DIR, 'portal', 'index.html')));
app.get(['/admin', '/admin/'], pageHeaders, (_req, res) =>
  res.sendFile(path.join(WEB_DIR, 'admin', 'index.html')));

// ── Site public : vitrine + documents légaux ─────────────────────────────────
// En-têtes DISTINCTS de `pageHeaders` sur un point qui compte : pas de
// `noindex`. Apple, Google Play et les autorités doivent pouvoir atteindre ces
// URLs, et la page CSAE doit être « globally accessible ».
//
// `script-src 'self'` (et non 'none' comme à l'origine) : la landing embarque
// le deck jouable du héros. Le script vit dans /assets/landing.js — AUCUN
// inline, AUCUN CDN, donc la directive reste stricte et ne s'ouvre ni à
// 'unsafe-inline' ni à un tiers. Les documents légaux, eux, restent sans une
// ligne de JavaScript : leurs accordéons sont des <details> natifs.
const SITE_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
].join('; ');

function siteHeaders(_req, res, next) {
  res.set('Content-Security-Policy', SITE_CSP);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
}

// URL publique → fichier. Ces chemins sont un CONTRAT : ils sont déclarés dans
// `frontend/src/config/index.ts`, dans la Play Console (standards CSAE, page de
// suppression de compte) et dans App Store Connect. Les renommer casse des
// liens que des tiers gardent en dur — n'en retirer aucun sans redirection.
const SITE_PAGES = {
  '/': 'index.html',
  '/legal': 'legal.html',
  '/mentions-legales': 'mentions-legales.html',
  '/confidentialite': 'confidentialite.html',
  '/cgu': 'cgu.html',
  '/cgv': 'cgv.html',
  '/regles-communaute': 'regles-communaute.html',
  '/securite-enfants': 'securite-enfants.html',
  '/moderation': 'moderation.html',
  '/intelligence-artificielle': 'intelligence-artificielle.html',
  '/cookies': 'cookies.html',
  '/conseils-securite': 'conseils-securite.html',
  '/supprimer-compte': 'supprimer-compte.html',
};

for (const [route, file] of Object.entries(SITE_PAGES)) {
  // Variante avec barre finale acceptée : `/cgu/` ne doit pas tomber en 404.
  const paths = route === '/' ? ['/'] : [route, `${route}/`];
  app.get(paths, siteHeaders, (_req, res) =>
    res.sendFile(path.join(WEB_DIR, 'site', file)));
}

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
