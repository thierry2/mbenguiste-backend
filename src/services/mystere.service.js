'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SERVICE MYSTÈRE — le JOB DE PASSE, orchestration PURE (tout l'I/O est injecté).
//
// Lancé périodiquement (setInterval dans server.js, comme la purge des comptes).
// À chaque tick il décide s'il faut apparier, et si oui écrit les paires. Toute
// la LOGIQUE vit ici et se teste avec des fakes ; l'accès Supabase vit dans le
// modèle (mystere.model.js), aussi mince que possible.
//
// Ordre, et pourquoi :
//   1. Fenêtre — hors du rendez-vous, on ne touche à rien (sauf `force`, pour
//      tester à la demande hors des heures).
//   2. Throttle — une passe toutes les ~`pass_minutes` : rapprocher deux passes
//      ne changerait rien (vivier quasi identique) mais brûlerait des requêtes.
//   3. Auto-réparation — les propositions non commencées trop vieilles se
//      défont : si l'un n'a jamais joué, l'autre est libéré pour être réapparié.
//   4. Appariement — le domaine (pur) décide ; on ne réécrit jamais une aventure
//      déjà commencée (verrouillée), on n'insère que les paires NOUVELLES.
//
// ⚠ Le plancher n'est JAMAIS abaissé, même en `force` : mieux vaut aucun mystère
// qu'un mystère tiède. `force` court-circuite la fenêtre et le throttle, rien
// d'autre.
// ─────────────────────────────────────────────────────────────────────────────
const { apparier, estDansLaFenetre, plancherApplicable } = require('../domain/mystere');

/** Clé de paire stable (ordre indifférent) pour comparer aux verrouillées. */
function cle(p) { return [...p].sort().join('|'); }

/** Le seed du jour (UTC) — l'appariement est rejouable à l'identique dans la journée. */
function seedDuJour(now) { return new Date(now).toISOString().slice(0, 10); }

/**
 * Une passe d'appariement. `deps` porte tout l'I/O (injecté → testable).
 * `opts.force` ignore la fenêtre et le throttle (outil de TEST), jamais le plancher.
 */
async function runMysteryPass(deps, now = Date.now(), opts = {}) {
  const {
    loadConfig, getLastPassAt, setLastPassAt,
    loadStaleProposed, dissolvePairs,
    loadLockedPairs, loadVivier, writePairs,
    scoreOf, desirabiliteOf, logger = { info() {}, warn() {} },
    notifyProposed = async () => {}, // best-effort : « un mystère t'attend » aux 2 membres
  } = deps;
  const force = !!opts.force;

  const cfg = await loadConfig();

  // ① La fenêtre — sauf en test forcé.
  if (!force && !estDansLaFenetre(now, cfg)) return { skipped: 'hors-fenetre' };

  // ② Le throttle — sauf en test forcé.
  if (!force) {
    const last = await getLastPassAt();
    if (last != null && now - last < cfg.pasMinutes * 60000) return { skipped: 'trop-tot' };
  }

  // ③ Auto-réparation : les propositions non commencées trop vieilles se défont.
  const avant = now - cfg.pasMinutes * 60000;
  const stale = (await loadStaleProposed(avant)) || [];
  if (stale.length) await dissolvePairs(stale);

  // ④ Appariement — le domaine décide, on ne fait qu'appliquer.
  // Le seuil d'inactivité vient de la CONFIG, pas du code : sur un vivier jeune
  // il peut assécher la passe, et on doit pouvoir l'ajuster sans redéployer.
  const { profils, eligibles } = await loadVivier(cfg.maxInactiviteJours);
  const verrouillees = (await loadLockedPairs()) || [];
  const plancher = plancherApplicable(now, cfg);

  const { paires } = apparier({
    profils, eligibles, plancher, verrouillees,
    score: scoreOf, desirabilite: desirabiliteOf,
    config: { poidsEcartDesirabilite: cfg.assortativeWeight },
    seed: seedDuJour(now),
  });

  // `apparier` renvoie les verrouillées EN TÊTE (elles sont déjà en base) : on
  // ne réécrit que ce qui est NOUVEAU.
  const dejaLa = new Set(verrouillees.map(cle));
  const nouvelles = paires.filter((p) => !dejaLa.has(cle(p)));
  // On ne notifie que les paires RÉELLEMENT créées (writePairs filtre les refus).
  const creees = nouvelles.length ? (await writePairs(nouvelles)) || [] : [];
  for (const [a, b] of creees) {
    await notifyProposed(a);
    await notifyProposed(b);
  }

  await setLastPassAt(now);
  logger.info(`[mystere] passe : ${creees.length} paire(s), ${stale.length} dissoute(s)${force ? ' (forcée)' : ''}`);
  return { paires: creees.length, dissoutes: stale.length, forced: force };
}

/**
 * Câblage réel : assemble le modèle Supabase et lance une passe. C'est ça que
 * `setInterval` (server.js) et la route admin de test appellent.
 */
async function runScheduledPass(opts = {}) {
  const model = require('../models/mystere.model');
  const logger = require('../utils/logger');
  const notif = require('./notification.service');
  return runMysteryPass(
    { ...model, logger, notifyProposed: (uid) => notif.onMystereProposed(uid) },
    Date.now(),
    opts,
  );
}

module.exports = { runMysteryPass, runScheduledPass };
