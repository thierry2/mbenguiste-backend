'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// commission — logique PURE du calcul d'une commission partenaire à partir d'un
// événement d'abonnement RevenueCat. Aucune I/O : entrées brutes → spec de ligne
// de registre (ou null si non commissionnable). Le service billing s'occupe de
// l'attribution (referral), du gel (partner frozen) et de l'écriture.
//
// Doctrine (18/07) : 30 % du revenu NET (après part store) récurrent 12 mois par
// abonné ; 40 % pour le Cercle Fondateur. Hold J+30 avant validation.
// Montants toujours en CENTIMES entiers — jamais de flottant en base.
// ─────────────────────────────────────────────────────────────────────────────

const HOLD_DAYS = 30;
const WINDOW_MONTHS = 12;
// Repli si RC n'envoie pas takehome_percentage (rare) : part store « pire cas »
// de la 1re année (30 % de commission store → 70 % net). Sous-estime le net donc
// ne surpaie jamais le partenaire.
const DEFAULT_TAKEHOME = 0.7;

// Seuls les événements qui encaissent RÉELLEMENT de l'argent commissionnent.
const COMMISSIONABLE = new Set(['INITIAL_PURCHASE', 'RENEWAL']);

function eventTimeMs(event, now) {
  const ms = Number(event.purchased_at_ms || event.event_timestamp_ms || 0);
  return ms > 0 ? ms : now.getTime();
}

/**
 * Calcule la commission d'un événement d'abonnement.
 *
 * @param {object}   event          événement RC (type, price, currency, takehome_percentage, purchased_at_ms…)
 * @param {number}   rateBps        taux du partenaire en points de base (3000 = 30 %)
 * @param {Date|null} firstPaymentAt date du 1er paiement de cet abonné (borne des 12 mois) ; null si c'est lui
 * @param {Date}     now            horloge injectée
 * @returns {object|null} spec de ligne (centimes) ou null si non commissionnable
 */
function computeCommission({ event, rateBps, firstPaymentAt = null, now = new Date() }) {
  if (!event || !COMMISSIONABLE.has(event.type)) return null;

  const price = Number(event.price ?? event.price_in_purchased_currency ?? 0);
  if (!(price > 0)) return null; // essai gratuit / prix nul → rien à commissionner

  const occurredMs = eventTimeMs(event, now);

  // Fenêtre 12 mois à partir du 1er paiement (une RENEWAL trop tardive ne paie plus).
  if (firstPaymentAt) {
    const windowEnd = new Date(firstPaymentAt);
    windowEnd.setMonth(windowEnd.getMonth() + WINDOW_MONTHS);
    if (occurredMs > windowEnd.getTime()) return null;
  }

  const takehome = Number(event.takehome_percentage);
  const takehomeRate = takehome > 0 && takehome <= 1 ? takehome : DEFAULT_TAKEHOME;

  const grossCents = Math.round(price * 100);
  const netCents = Math.round(price * takehomeRate * 100);
  const commissionCents = Math.round((netCents * rateBps) / 10000);
  if (commissionCents <= 0) return null; // sous le centime → on n'inscrit rien

  const holdUntil = new Date(occurredMs + HOLD_DAYS * 24 * 60 * 60 * 1000);

  return {
    eventType: event.type,
    grossCents,
    netCents,
    rateBps,
    commissionCents,
    currency: event.currency || 'EUR',
    occurredAt: new Date(occurredMs),
    holdUntil,
  };
}

/**
 * Un événement RC porte-t-il un remboursement ? (→ on annule la commission liée.)
 * RC signale un remboursement par un CANCELLATION/EXPIRATION dont le motif est
 * l'assistance client.
 */
function isRefund(event) {
  if (!event) return false;
  if (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT') return true;
  if (event.type === 'EXPIRATION' && event.expiration_reason === 'CUSTOMER_SUPPORT') return true;
  return false;
}

module.exports = { computeCommission, isRefund, HOLD_DAYS, WINDOW_MONTHS, DEFAULT_TAKEHOME };
