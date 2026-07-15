'use strict';
const defaultGrantsModel = require('../models/grants.model');
const defaultCreditsModel = require('../models/credits.model');
const { grantsDue, periodKey } = require('../domain/access');

/**
 * Avantages récurrents des paliers (5 Super Likes/sem et 1 Boost/mois pour
 * Or+, 1 Joker/sem pour Prestige), octroyés PARESSEUSEMENT : appelé à chaque
 * lecture des droits (pas de cron), idempotent par période grâce au registre
 * recurring_grants (claim = insert unique profil × kind × période).
 *
 * Fail-soft : un échec de versement ne casse jamais la lecture des droits —
 * la réservation est rendue et le prochain passage réessaie.
 */
function createGrantsService({ grantsModel, creditsModel }) {
  async function ensure(userId, tier, offert, now = Date.now()) {
    const due = grantsDue(tier, offert);
    for (const g of due) {
      const key = periodKey(g.period, now);
      try {
        const claimed = await grantsModel.claim(userId, g.kind, key);
        if (!claimed) continue; // déjà versé cette période (ou course perdue)
        try {
          await creditsModel.grant(userId, {
            superLikes: g.kind === 'superlike' ? g.quantity : 0,
            boosts:     g.kind === 'boost'     ? g.quantity : 0,
            jokers:     g.kind === 'joker'     ? g.quantity : 0,
          });
        } catch (err) {
          // Versement raté : on rend la réservation pour que ça retente plus tard.
          await grantsModel.release?.(userId, g.kind, key);
          throw err;
        }
      } catch {
        // Silencieux : les droits restent lisibles même si la base tousse.
      }
    }
  }

  return { ensure };
}

const defaultService = createGrantsService({
  grantsModel: defaultGrantsModel,
  creditsModel: defaultCreditsModel,
});

module.exports = { createGrantsService, ensure: defaultService.ensure };
