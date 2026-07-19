'use strict';
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Authentification de la console admin.
//
// AVANT : le secret partagé était stocké en clair dans le localStorage du
// navigateur et renvoyé à chaque requête, indéfiniment. Un poste partagé, une
// extension curieuse ou une XSS, et le secret PERMANENT fuit.
//
// MAINTENANT : le secret ne sert qu'UNE fois, pour obtenir un JETON DE SESSION
// signé et court (HMAC-SHA256 du payload avec le secret comme clé). Le jeton vit
// en sessionStorage (mort à la fermeture de l'onglet) et expire tout seul.
// Le secret lui-même ne séjourne plus dans le navigateur.
//
// + Verrouillage progressif par IP : une console qui protège des récits
//   d'agressions ne doit pas se laisser forcer à l'aveugle.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 8 * 60 * 60 * 1000;        // 8 h : une session de travail, pas plus
const MAX_FAILS = 5;                       // au-delà → verrou
const LOCK_BASE_MS = 5 * 60 * 1000;        // 5 min, doublé à chaque récidive
const LOCK_MAX_MS = 60 * 60 * 1000;        // plafond 1 h

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Comparaison à temps constant (un `===` fuit le secret caractère par caractère). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function sign(payloadB64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Émet un jeton de session signé, valable TTL_MS. */
function issueToken(now = Date.now(), secret = config.admin.secret) {
  if (!secret) return null;
  const payload = b64url(JSON.stringify({ exp: now + TTL_MS, n: crypto.randomBytes(9).toString('base64url') }));
  return `${payload}.${sign(payload, secret)}`;
}

/** Vérifie un jeton (signature + expiration). → true/false, jamais d'exception. */
function verifyToken(token, now = Date.now(), secret = config.admin.secret) {
  if (!secret || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  if (!safeEqual(mac, sign(payload, secret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}

// ── Verrouillage anti-force brute (en mémoire : une seule instance Railway) ──
const attempts = new Map(); // ip → { fails, lockedUntil, strikes }

function lockState(ip, now = Date.now()) {
  const a = attempts.get(ip);
  if (!a || !a.lockedUntil || a.lockedUntil <= now) return { locked: false, remainingMs: 0 };
  return { locked: true, remainingMs: a.lockedUntil - now };
}

/** Enregistre un échec ; verrouille au-delà de MAX_FAILS (délai doublé à chaque récidive). */
function registerFailure(ip, now = Date.now()) {
  const a = attempts.get(ip) || { fails: 0, lockedUntil: 0, strikes: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.strikes += 1;
    a.lockedUntil = now + Math.min(LOCK_BASE_MS * 2 ** (a.strikes - 1), LOCK_MAX_MS);
    a.fails = 0;
    logger.warn(`[AUDIT] admin.lockout ip=${ip} strikes=${a.strikes} until=${new Date(a.lockedUntil).toISOString()}`);
  }
  attempts.set(ip, a);
  return lockState(ip, now);
}

/** Succès : on efface les échecs (les récidives restent, pour ne pas remettre le compteur à neuf). */
function registerSuccess(ip) {
  const a = attempts.get(ip);
  if (a) { a.fails = 0; a.lockedUntil = 0; attempts.set(ip, a); }
}

/**
 * Trace d'audit : qui a fait quoi, quand, depuis où.
 * Défensif à dessein — un journal ne doit JAMAIS faire tomber la requête qu'il
 * observe (les requêtes simulées des tests n'ont pas `req.get`).
 */
function audit(req, action, details = '') {
  try {
    const ua = typeof req.get === 'function'
      ? req.get('user-agent')
      : req.headers && req.headers['user-agent'];
    logger.info(`[AUDIT] ${action} ip=${req.ip || '?'} ua="${String(ua || '').slice(0, 80)}"${details ? ` ${details}` : ''}`);
  } catch {
    /* jamais bloquant */
  }
}

/** Purge périodique (évite qu'une Map grossisse indéfiniment). */
function purgeExpired(now = Date.now()) {
  for (const [ip, a] of attempts) {
    if ((!a.lockedUntil || a.lockedUntil <= now) && a.fails === 0) attempts.delete(ip);
  }
}

module.exports = {
  issueToken, verifyToken, registerFailure, registerSuccess, lockState, audit, purgeExpired,
  TTL_MS, MAX_FAILS,
};
