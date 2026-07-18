const moderationModel = require('../models/moderation.model');

/**
 * Regroupe les connexions d'un membre pour l'écran « Signaler quelqu'un » :
 *  - enCours   : matchs actifs (on peut signaler sans attendre un problème) ;
 *  - anciennes : matchs défaits (par soi OU par l'autre — soft delete) et
 *                membres bloqués. C'est la promesse du centre : un match
 *                disparu n'empêche jamais de signaler.
 *
 * PURE — aucune I/O : entrées = lignes brutes des tables, testée à sec
 * (tests/unit/safety-connections.test.js).
 *
 * Déduplication : bloquer désactive aussi le match (moderation.model.block),
 * la même personne arriverait donc deux fois ; le blocage l'emporte (sa date
 * est celle du geste), le matchId est conservé pour le dossier.
 *
 * @param {string} userId
 * @param {Array<{id:string,user_low:string,user_high:string,created_at:string,ended_at:string|null,is_active:boolean}>} matchRows
 * @param {Array<{blocked_id:string,created_at:string}>} blockRows
 * @param {Map<string,{id:string,prenom:string,avatarUrl:string|null}>} profilesById
 */
function buildPastConnections(userId, matchRows, blockRows, profilesById) {
  const blockedIds = new Set(blockRows.map((b) => b.blocked_id));
  const matchIdByProfile = new Map();

  const enCours = [];
  const anciennes = [];

  for (const m of matchRows) {
    const otherId = m.user_low === userId ? m.user_high : m.user_low;
    const profil = profilesById.get(otherId);
    if (!profil) continue; // compte supprimé entre les deux requêtes
    matchIdByProfile.set(otherId, m.id);
    if (blockedIds.has(otherId)) continue; // le blocage l'emporte (ajouté plus bas)

    if (m.is_active) {
      enCours.push({
        profileId: otherId, matchId: m.id, prenom: profil.prenom,
        avatarUrl: profil.avatarUrl, type: 'match', depuis: m.created_at,
      });
    } else {
      anciennes.push({
        profileId: otherId, matchId: m.id, prenom: profil.prenom,
        avatarUrl: profil.avatarUrl, type: 'unmatch', finLe: m.ended_at ?? null,
      });
    }
  }

  for (const b of blockRows) {
    const profil = profilesById.get(b.blocked_id);
    if (!profil) continue;
    anciennes.push({
      profileId: b.blocked_id, matchId: matchIdByProfile.get(b.blocked_id) ?? null,
      prenom: profil.prenom, avatarUrl: profil.avatarUrl, type: 'block', finLe: b.created_at,
    });
  }

  const desc = (a, b) => (b ?? '').localeCompare(a ?? ''); // ISO : ordre lexical = ordre temporel
  enCours.sort((a, b) => desc(a.depuis, b.depuis));
  // Fin la plus récente d'abord ; les unmatch d'avant la migration (sans date) ferment la liste.
  anciennes.sort((a, b) => {
    if (!a.finLe && !b.finLe) return 0;
    if (!a.finLe) return 1;
    if (!b.finLe) return -1;
    return desc(a.finLe, b.finLe);
  });

  return { enCours, anciennes };
}

/** GET /profiles/me/past-connections — assemble les lignes puis délègue au pur. */
async function pastConnections(userId) {
  const { matchRows, blockRows, profilesById } = await moderationModel.listConnectionsRaw(userId);
  return buildPastConnections(userId, matchRows, blockRows, profilesById);
}

/** Dossier libre : la personne n'apparaît dans aucune connexion. */
async function reportFreeform(reporterId, body) {
  await moderationModel.createFreeformReport(reporterId, body.trim());
}

module.exports = { buildPastConnections, pastConnections, reportFreeform };
