'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Vérification par selfie — orchestration.
//
// Anti-fraude : le SERVEUR tire la pose (main sur l'oreille, sur la tête…) au
// moment où la personne démarre. Elle ne peut pas la connaître à l'avance, donc
// pas préparer la photo. Capture caméra live, fenêtre courte, revue humaine.
//
// Deux horloges à ne jamais confondre (cf. src/domain/verification.js) :
//  • fenêtre de CAPTURE (start → envoi) : courte, EXPIRE.
//  • REVUE humaine (envoi → décision) : peut durer des jours, N'EXPIRE PAS.
//
// La mise en forme (`buildStatus`) est PURE et testée à sec — c'est elle qui
// décide ce que l'écran mobile affiche dans chacun des états.
// ─────────────────────────────────────────────────────────────────────────────
const model = require('../models/verification.model');
const uploadService = require('./upload.service');
const notifications = require('./notification.service');
const ApiError = require('../utils/apiError');
const domain = require('../domain/verification');

/**
 * PUR — l'état complet à afficher côté mobile, à partir des lignes brutes.
 * `profile` porte le sceau actuel ; `request` est la requête active (ou null) ;
 * `last` la dernière tout statut ; `history` l'historique des rejets.
 *
 * `state` est le seul champ que l'UI doit lire pour choisir son écran :
 *   idle | capturing | pending | verified | rejected | cooldown
 */
function buildStatus({ profile, request, last, history }, now = new Date()) {
  if (profile?.is_verified) {
    return {
      state: 'verified',
      verifiedAt: profile.verified_at ?? null,
      pose: null, captureExpiresAt: null, canStart: false,
      rejectionReason: null, retryAt: null,
    };
  }

  // Requête active : soit on capture, soit on attend l'admin.
  if (request && domain.isActiveStatus(request.status)) {
    if (request.status === 'pending_review') {
      return {
        state: 'pending',
        submittedAt: request.submitted_at ?? null,
        pose: null, captureExpiresAt: null, canStart: false,
        rejectionReason: null, retryAt: null, verifiedAt: null,
      };
    }
    // awaiting_selfie — mais la fenêtre a pu passer entre-temps.
    if (!domain.isCaptureExpired(request, now)) {
      const pose = domain.poseByCode(request.pose_code);
      return {
        state: 'capturing',
        requestId: request.id,
        pose,
        captureExpiresAt: request.capture_expires_at,
        canStart: false,
        rejectionReason: null, retryAt: null, verifiedAt: null,
      };
    }
    // Fenêtre écoulée → on retombe sur le cas « peut redémarrer » ci-dessous.
  }

  const retry = domain.retryPolicy(history, now);
  if (!retry.canRetry) {
    return {
      state: 'cooldown',
      retryAt: retry.retryAt,
      rejectionReason: last?.status === 'rejected' ? (last.rejection_reason ?? null) : null,
      pose: null, captureExpiresAt: null, canStart: false, verifiedAt: null,
    };
  }

  if (last?.status === 'rejected') {
    return {
      state: 'rejected',
      rejectionReason: last.rejection_reason ?? null,
      canStart: true,
      pose: null, captureExpiresAt: null, retryAt: null, verifiedAt: null,
    };
  }

  return {
    state: 'idle',
    canStart: true,
    pose: null, captureExpiresAt: null, rejectionReason: null,
    retryAt: null, verifiedAt: null,
  };
}

/** PUR — une ligne de la file admin, prête à afficher (selfie déjà signé). */
function buildQueueItem(request, subject, selfieUrl) {
  const pose = domain.poseByCode(request.pose_code);
  return {
    id: request.id,
    userId: request.user_id,
    prenom: subject?.prenom ?? null,
    avatarUrl: subject?.avatarUrl ?? null,
    photos: subject?.photos ?? [],
    dejaVerifiee: subject?.dejaVerifiee ?? false,
    // La consigne exacte qu'on lui a imposée : sans elle, l'admin ne peut rien juger.
    poseCode: request.pose_code,
    poseInstruction: pose?.instruction ?? request.pose_code,
    poseHint: pose?.hint ?? null,
    selfieUrl,
    tentative: request.attempt_no,
    soumisLe: request.submitted_at,
  };
}

// ── Côté utilisatrice ────────────────────────────────────────────────────────

async function getStatus(userId, profile) {
  // Nettoyage paresseux : pas de cron pour ça, la lecture suffit à ranger.
  await model.expireStaleCaptures().catch(() => {});
  const [request, last, history] = await Promise.all([
    model.activeFor(userId),
    model.lastFor(userId),
    model.rejectionHistory(userId),
  ]);
  return buildStatus({ profile, request, last, history });
}

/**
 * Démarre une vérification : tire la pose et ouvre la fenêtre de capture.
 * Idempotent — rappeler pendant une capture en cours renvoie LA MÊME pose
 * (sinon un réseau qui coupe au mauvais moment ferait tourner la roue).
 */
async function start(userId, profile, { rng } = {}) {
  if (profile?.is_verified) throw ApiError.badRequest('Ton profil est déjà vérifié');

  await model.expireStaleCaptures().catch(() => {});

  const existing = await model.activeFor(userId);
  if (existing) {
    if (existing.status === 'pending_review') {
      throw ApiError.badRequest('Ta vérification est déjà en cours d\'examen');
    }
    if (!domain.isCaptureExpired(existing)) {
      return {
        requestId: existing.id,
        pose: domain.poseByCode(existing.pose_code),
        captureExpiresAt: existing.capture_expires_at,
      };
    }
  }

  const history = await model.rejectionHistory(userId);
  const retry = domain.retryPolicy(history);
  if (!retry.canRetry) {
    throw ApiError.badRequest('Trop de tentatives refusées. Réessaie plus tard.');
  }

  const pose = domain.pickPose(rng);
  const request = await model.create({
    userId,
    poseCode: pose.code,
    captureExpiresAt: domain.captureExpiryFrom(),
    attemptNo: history.attempts + 1,
  });

  return { requestId: request.id, pose, captureExpiresAt: request.capture_expires_at };
}

/**
 * Envoie le selfie. On revalide la fenêtre côté serveur : le client peut mentir,
 * avoir une horloge décalée, ou revenir d'un long passage hors réseau.
 */
async function submitSelfie(userId, file) {
  if (!file) throw ApiError.badRequest('Aucun selfie reçu');

  const request = await model.activeFor(userId);
  const gate = domain.canSubmitSelfie(request);
  if (!gate.ok) {
    if (gate.reason === 'capture_expired') {
      // On range tout de suite : l'écran suivant proposera une NOUVELLE pose.
      await model.expireStaleCaptures().catch(() => {});
      throw ApiError.badRequest('Le temps est écoulé. Relance la vérification pour une nouvelle pose.');
    }
    if (gate.reason === 'wrong_status') throw ApiError.badRequest('Ta vérification est déjà en cours d\'examen');
    throw ApiError.badRequest('Aucune vérification en cours');
  }

  const { path } = await uploadService.uploadVerificationSelfie(file, userId);

  const updated = await model.attachSelfie(request.id, path);
  if (!updated) {
    // Course perdue (double envoi) : on ne laisse pas le fichier orphelin.
    await uploadService.removeVerificationSelfie(path).catch(() => {});
    throw ApiError.badRequest('Ta vérification est déjà en cours d\'examen');
  }

  return { state: 'pending', submittedAt: updated.submitted_at };
}

// ── Côté console admin ───────────────────────────────────────────────────────

async function listQueue(limit = 100) {
  const requests = await model.reviewQueue(limit);
  return Promise.all(requests.map(async (r) => {
    const [subject, selfieUrl] = await Promise.all([
      model.reviewSubject(r.user_id),
      uploadService.signVerificationUrl(r.selfie_path),
    ]);
    return buildQueueItem(r, subject, selfieUrl);
  }));
}

/**
 * Décision humaine. Approuver accorde le sceau ; refuser laisse repartir sur une
 * NOUVELLE pose (après cooldown si les essais libres sont épuisés).
 *
 * Le selfie est effacé du bucket dans les deux cas : on ne conserve pas une
 * photo biométrique après usage. La trace (qui, quand, quelle pose, quel motif)
 * reste en base pour l'audit.
 */
async function decide(requestId, { approve, reason = null, reviewedBy = 'admin' }) {
  if (!approve && !reason) throw ApiError.badRequest('Un motif de refus est requis');

  const before = await model.byId(requestId);
  if (!before) throw ApiError.notFound('Demande introuvable');
  if (before.status !== 'pending_review') throw ApiError.badRequest('Cette demande a déjà été traitée');

  const decided = await model.decide(requestId, {
    status: approve ? 'approved' : 'rejected',
    reviewedBy,
    reason: approve ? null : reason,
  });
  if (!decided) throw ApiError.badRequest('Cette demande a déjà été traitée');

  if (approve) await model.setVerified(before.user_id, true);

  // Best-effort, dans cet ordre : la décision est déjà actée en base, ni le
  // ménage du bucket ni le push ne doivent pouvoir la faire échouer.
  await uploadService.removeVerificationSelfie(before.selfie_path).catch(() => {});
  notifications.onVerificationDecided(before.user_id, approve).catch(() => {});

  return { id: requestId, status: decided.status, userId: before.user_id };
}

async function pendingCount() {
  return model.pendingCount();
}

module.exports = {
  buildStatus, buildQueueItem,
  getStatus, start, submitSelfie,
  listQueue, decide, pendingCount,
};
