const moderationModel = require('../models/moderation.model');
const adminModel = require('../models/adminModeration.model');

/**
 * Console de modération — met les signalements en DOSSIERS par personne.
 *
 * Pourquoi pas ticket par ticket (modèle de la console AfrikMoms) : sur une app
 * de rencontre, ce qui condamne n'est presque jamais un signalement isolé, c'est
 * la RÉCURRENCE. Trois femmes qui n'ont aucun lien entre elles décrivant le même
 * comportement en trois semaines, c'est la seule chose qui distingue un
 * prédateur d'un malentendu. Ticket par ticket, ce motif reste invisible.
 *
 * `buildDossiers` et `graviteDe` sont PURS — testés à sec
 * (tests/unit/admin-moderation.test.js).
 */

// Le pire motif du dossier commande l'ordre de lecture. « underage » et
// « threats » sortent du champ de la modération ordinaire : ils appellent une
// action tout de suite, avant même de lire le reste de la pile.
const CRITIQUE = new Set(['underage', 'threats']);
const ELEVE = new Set(['offline_behavior', 'scam', 'hate', 'harassment', 'inappropriate']);

function graviteDe(codes) {
  if (codes.some((c) => CRITIQUE.has(c))) return 'critique';
  if (codes.some((c) => ELEVE.has(c))) return 'eleve';
  return 'standard';
}

const RANG_GRAVITE = { critique: 0, eleve: 1, standard: 2 };

/**
 * @param {Array<{id,reported_id,reporter_id,reason_code,reason_label,details,status,created_at}>} rows
 * @param {Map<string,{id,prenom,avatarUrl,estRetire}>} profilesById
 */
function buildDossiers(rows, profilesById) {
  const parCible = new Map();

  for (const row of rows) {
    let d = parCible.get(row.reported_id);
    if (!d) {
      const p = profilesById.get(row.reported_id);
      d = {
        profileId: row.reported_id,
        // Le compte a pu être supprimé entre la requête et l'affichage : le
        // dossier reste lisible (il documente ce qui s'est passé), il ne
        // disparaît pas avec son sujet.
        prenom: p?.prenom ?? 'Compte supprimé',
        avatarUrl: p?.avatarUrl ?? null,
        dejaRetire: p?.estRetire ?? false,
        signalements: [],
        _signalants: new Set(),
        _motifs: new Map(),
      };
      parCible.set(row.reported_id, d);
    }
    d.signalements.push({
      id: row.id,
      motif: row.reason_code,
      motifLabel: row.reason_label,
      details: row.details ?? null,
      statut: row.status,
      le: row.created_at,
    });
    d._signalants.add(row.reporter_id);
    d._motifs.set(row.reason_code, (d._motifs.get(row.reason_code) ?? 0) + 1);
  }

  const dossiers = [...parCible.values()].map((d) => {
    const codes = [...d._motifs.keys()];
    const motifs = [...d._motifs.entries()]
      .map(([code, nombre]) => ({ code, nombre }))
      .sort((a, b) => b.nombre - a.nombre || a.code.localeCompare(b.code));
    // ISO : l'ordre lexical est l'ordre temporel.
    const dernierLe = d.signalements.reduce((max, s) => (s.le > max ? s.le : max), '');
    d.signalements.sort((a, b) => (b.le > a.le ? 1 : -1));
    return {
      profileId: d.profileId,
      prenom: d.prenom,
      avatarUrl: d.avatarUrl,
      dejaRetire: d.dejaRetire,
      signalants: d._signalants.size,
      motifs,
      gravite: graviteDe(codes),
      dernierLe,
      signalements: d.signalements,
    };
  });

  dossiers.sort((a, b) =>
    RANG_GRAVITE[a.gravite] - RANG_GRAVITE[b.gravite]
    || b.signalants - a.signalants
    || (b.dernierLe > a.dernierLe ? 1 : -1));

  return dossiers;
}

// ── Lectures et actions (I/O) ────────────────────────────────────────────────

/** Dossiers ouverts (ou tous), prêts pour la console. */
async function listDossiers(statut) {
  const { rows, profilesById } = await adminModel.listReportsWithProfiles(statut);
  return buildDossiers(rows, profilesById);
}

async function listFreeform(statut) {
  return adminModel.listFreeformReports(statut);
}

/**
 * Clôt TOUS les signalements ouverts d'un profil d'un seul geste : la décision
 * porte sur la personne, donc sur le dossier entier. Traiter les tickets un par
 * un rouvrait le même profil trois fois de suite dans la file.
 */
async function traiterDossier(profileId, { action, note }) {
  if (action === 'retirer') await moderationModel.hideFromDiscovery(profileId);
  if (action === 'restaurer') await adminModel.restoreToDiscovery(profileId);
  await adminModel.closeReportsFor(profileId, 'closed', note ?? null, action);
  return { profileId, action };
}

async function traiterDossierLibre(id, { action, note }) {
  await adminModel.closeFreeformReport(id, note ?? null, action);
  return { id, action };
}

module.exports = {
  buildDossiers, graviteDe,
  listDossiers, listFreeform, traiterDossier, traiterDossierLibre,
};
