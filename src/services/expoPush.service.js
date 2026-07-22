const supabase = require('../config/supabase');
const pushTokens = require('../models/pushTokens.model');

// ─────────────────────────────────────────────────────────────────────────────
// Envoi de push via l'API Expo (portage à l'identique d'AfrikMoms). Aucune clé
// n'est requise côté serveur : l'endpoint Expo est public, c'est le lien
// Expo↔FCM (credentials du projet EAS) qui authentifie la livraison.
// Les tokens vivent dans `push_tokens` — UN PAR APPAREIL (migration 037). Avant,
// une colonne unique sur `profiles` faisait qu'un second téléphone rendait le
// premier muet sans le dire. On envoie donc à TOUS les appareils du compte, et
// un token mort se supprime tout seul au lieu de laisser le compte silencieux.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le canal Android visé selon le type. Les notifications du JEU (« ton binôme a
 * joué ») partent sur leur propre canal, en importance MAX côté client : elles
 * doivent s'imposer, et le membre doit pouvoir couper le reste SANS couper le
 * jeu. Tout le reste garde `default`. Le canal doit exister côté app
 * (`setupAndroidChannel`) — sinon Android retombe silencieusement sur default,
 * ce qui reste un comportement acceptable.
 */
const CANAUX = { mystere_turn: 'mystere', mystere_reveal: 'mystere' };

async function sendPush(userId, opts) {
  const tokens = await pushTokens.listFor(userId);
  if (!tokens.length) {
    console.log('[expoPush] aucun token livrable pour', userId, '→ aucune push');
    return;
  }
  // Un appareil injoignable ne doit pas empêcher les autres d'être servis :
  // chaque envoi est indépendant et ses erreurs sont déjà avalées.
  await Promise.all(tokens.map((t) => _envoyerA(userId, t, opts)));
}

/** Un envoi vers UN appareil. Ses erreurs sont avalées : un appareil
 *  injoignable ne doit jamais empêcher les autres d'être servis. */
async function _envoyerA(userId, token, { title, body, data = {}, silent = false }) {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // title/body à la racine (message FCM « notification ») : l'OS affiche la notif
      // nativement même si l'app est gelée en arrière-plan (Doze, restrictions batterie
      // MIUI…) — on ne peut pas exiger que chaque utilisateur whiteliste l'app. `data`
      // reste inclus pour le tap (routage).
      //
      // SILENCIEUX (réglage notif coupé) : title/body déplacés DANS `data`, rien à la
      // racine → message « data-only », l'OS n'affiche RIEN dans la barre système ;
      // l'app au premier plan le reçoit quand même. Doctrine : les réglages ne coupent
      // que les notifications SYSTÈME.
      body: JSON.stringify(
        silent
          ? { to: token, data: { ...data, title, body, silent: '1' }, priority: 'high' }
          : {
            to: token, title, body, data, sound: 'default',
            channelId: CANAUX[data?.type] || 'default', priority: 'high',
          },
      ),
    });
    // La réponse d'Expo contient un « ticket » par push : status 'ok' OU 'error'
    // (+ details.error = DeviceNotRegistered / MismatchSenderId / InvalidCredentials…).
    // Sans ce log, un rejet d'Expo passe totalement inaperçu (fire-and-forget).
    const json = await res.json().catch(() => null);
    const ticket = json?.data;
    if (ticket?.status === 'error') {
      console.warn('[expoPush] ticket en erreur:', JSON.stringify(ticket));
    }

    // « ok » ici = juste MIS EN FILE. Le vrai résultat de livraison (Expo→FCM→appareil)
    // est dans le REÇU, dispo quelques secondes plus tard. C'est LUI qui révèle
    // DeviceNotRegistered / MismatchSenderId / InvalidCredentials (credentials FCM du
    // projet Expo mal configurés).
    const ticketId = ticket?.id;
    if (ticketId) setTimeout(() => _logReceipt(ticketId, userId, token), 5000);
  } catch (e) {
    console.warn('[expoPush] envoi échoué:', e?.message);
  }
}

async function _logReceipt(ticketId, userId = null, sentToken = null) {
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: [ticketId] }),
    });
    const json = await res.json().catch(() => null);
    const receipt = json?.data?.[ticketId];
    if (receipt?.status === 'error') {
      console.warn('[expoPush] REÇU en erreur', ticketId, '→', JSON.stringify(receipt));
    }

    // Token MORT (désinstallation/réinstallation → nouveau token, l'ancien reste en base
    // jusqu'à la prochaine ouverture de l'app) : on l'efface pour arrêter d'envoyer dans
    // le vide. Garde `.eq('push_token', sentToken)` : si l'utilisateur a rouvert l'app
    // entre l'envoi et ce reçu (~5 s), son NOUVEAU token vient d'être enregistré — on ne
    // l'écrase pas.
    if (receipt?.status === 'error' && receipt?.details?.error === 'DeviceNotRegistered' && sentToken) {
      // On supprime LE TOKEN, pas « le token du compte » : c'est un appareil
      // précis qui a disparu, les autres du même compte restent joignables.
      await pushTokens.remove(sentToken);
      console.log('[expoPush] token mort supprimé:', sentToken.slice(0, 24), '…');
    }
  } catch (e) {
    console.warn('[expoPush] getReceipts échoué:', e?.message);
  }
}

module.exports = { sendPush };
