'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE JOB DE RELANCE — le filet qui empêche une aventure de mourir en silence.
//
// L'un a répondu, l'autre ne revient pas. Le binôme a été prévenu une fois ; si
// la notification a été balayée, plus rien ne le lui redit. Ce job rappelle —
// UNE fois par tour, après un long silence.
//
// I/O injecté (comme `aventure.service`) : la décision vit dans le domaine
// (`sessionsARelancer`, 10 tests), ici on ne fait qu'exécuter.
// ─────────────────────────────────────────────────────────────────────────────
const { sessionsARelancer } = require('../domain/aventureRelance');

/**
 * Un passage. Renvoie le nombre de relances envoyées (utile aux tests et au log).
 *
 * BEST-EFFORT DE BOUT EN BOUT : ce job tourne en arrière-plan, personne ne le
 * regarde. Une session qui échoue ne doit pas emporter les autres, et une panne
 * de push ne doit pas empêcher de marquer le tour comme relancé — sinon on
 * réessaierait à chaque tick, et le filet deviendrait du harcèlement.
 */
async function passerRelances(deps, { maintenant = Date.now(), apresMs } = {}) {
  const { attentesARelancer, marquerRelance, membresDePaire, roleOf, notifier } = deps;

  const lignes = await attentesARelancer();
  const aRelancer = sessionsARelancer({ lignes, maintenant, apresMs });

  let envoyees = 0;
  for (const r of aRelancer) {
    try {
      const membres = r.pairId ? await membresDePaire(r.pairId) : null;
      if (!Array.isArray(membres) || membres.length < 2) continue;
      // Le rôle 'a' est le membre « low » de la paire, 'b' le « high » — même
      // convention que `roleDe`. On demande au modèle plutôt que de la
      // redéduire ici : une convention dupliquée finit toujours par diverger.
      let cible = null;
      for (const m of membres) {
        if (await roleOf(r.pairId, m) === r.roleARelancer) { cible = m; break; }
      }
      if (!cible) continue;

      // On MARQUE AVANT d'envoyer : si le push échoue, on ne réessaie pas au
      // tick suivant. Rater une relance est bénin ; en envoyer une par minute
      // ferait désinstaller l'app.
      await marquerRelance(r.sessionId);
      await notifier(cible, 'mystere_relance');
      envoyees += 1;
    } catch (e) {
      console.error('[relance] session', r.sessionId, ':', e && e.message);
    }
  }
  return envoyees;
}

/** Câblage réel — appelé par le tick de `server.js`. */
async function passer() {
  const model = require('../models/mystere.model');
  const notif = require('./notification.service');
  return passerRelances({
    attentesARelancer: model.attentesARelancer,
    marquerRelance: model.marquerRelance,
    membresDePaire: model.membresDePaire,
    roleOf: model.roleOf,
    notifier: (uid, type) => (type === 'mystere_relance'
      ? notif.onMystereRelance(uid)
      : Promise.resolve()),
  });
}

module.exports = { passerRelances, passer };
