'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// partnerStats — agrégations PURES du registre de commissions pour le portail.
//
// Pas de cron J+30 : le statut « validé » est DÉRIVÉ de hold_until. Une ligne
// 'pending' dont le hold est passé compte comme validée (donc payable) ; sinon
// elle reste en attente. 'paid' = déjà versée ; 'reversed' = remboursée (ignorée).
// Montants en centimes entiers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solde par état, dérivé à l'instant `now`.
 * @param {Array<{commissionCents:number,status:string,holdUntil:string|Date}>} rows
 * @returns {{pendingCents:number, validatedCents:number, paidCents:number}}
 */
function summarizeBalance(rows, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  let pendingCents = 0;
  let validatedCents = 0;
  let paidCents = 0;

  for (const r of rows || []) {
    const cents = Number(r.commissionCents) || 0;
    if (r.status === 'paid') {
      paidCents += cents;
    } else if (r.status === 'validated') {
      validatedCents += cents;
    } else if (r.status === 'pending') {
      const held = new Date(r.holdUntil).getTime();
      if (held <= t) validatedCents += cents; // hold J+30 écoulé → payable
      else pendingCents += cents;
    }
    // 'reversed' : ignoré
  }
  return { pendingCents, validatedCents, paidCents };
}

/** Somme des commissions (hors remboursées) survenues depuis `since`. */
function sumSince(rows, since) {
  const from = since instanceof Date ? since.getTime() : new Date(since).getTime();
  let cents = 0;
  for (const r of rows || []) {
    if (r.status === 'reversed') continue;
    if (new Date(r.occurredAt).getTime() >= from) cents += Number(r.commissionCents) || 0;
  }
  return cents;
}

/** Lignes actuellement PAYABLES (validées et non encore versées) à l'instant `now`. */
function payableRows(rows, now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return (rows || []).filter(
    (r) => (r.status === 'validated')
      || (r.status === 'pending' && new Date(r.holdUntil).getTime() <= t),
  );
}

/**
 * Série quotidienne des commissions sur les `days` derniers jours, pour la courbe
 * du portail. Renvoie TOUJOURS un point par jour (zéros compris) : sans les
 * creux, une courbe ment sur le rythme réel.
 * @returns {Array<{date:string, cents:number}>} du plus ancien au plus récent
 */
function dailySeries(rows, { days = 30, now = new Date() } = {}) {
  const jour = 24 * 60 * 60 * 1000;
  const fin = new Date(now);
  fin.setUTCHours(0, 0, 0, 0);

  const seau = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    seau.set(new Date(fin.getTime() - i * jour).toISOString().slice(0, 10), 0);
  }

  for (const r of rows || []) {
    if (r.status === 'reversed') continue;
    const cle = new Date(r.occurredAt).toISOString().slice(0, 10);
    if (seau.has(cle)) seau.set(cle, seau.get(cle) + (Number(r.commissionCents) || 0));
  }

  return [...seau.entries()].map(([date, cents]) => ({ date, cents }));
}

module.exports = { summarizeBalance, sumSince, payableRows, dailySeries };
