'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// verification — logique PURE de la vérification par selfie (aucun I/O, aucun
// Supabase). Le serveur impose une pose tirée AU HASARD que la personne ne peut
// pas connaître à l'avance ; elle prend un selfie EN DIRECT ; un humain valide.
//
// Deux fenêtres de temps distinctes, à ne jamais confondre :
//  • la fenêtre de CAPTURE (start → envoi du selfie) est courte : la pose ne doit
//    pas pouvoir être préparée tranquillement. Elle EXPIRE.
//  • la REVUE humaine (envoi → décision) peut prendre plusieurs jours et
//    N'EXPIRE PAS — une fois le selfie envoyé, ça attend l'admin.
//
// Testé à sec dans tests/unit/verification.test.js.
// ─────────────────────────────────────────────────────────────────────────────

// Fenêtre pour capturer une fois la pose révélée.
//
// 3 min et pas davantage : la fenêtre n'est PAS un temps de préparation, c'est
// ce qui la rend impossible. Elle couvre lire la consigne, ouvrir la caméra,
// poser, relire et envoyer — y compris avec un upload lent (jusqu'à 60 s). Elle
// ne couvre pas aller chercher quelqu'un, chercher comment faire, ou mettre
// quoi que ce soit en scène.
//
// (Était à 20 min : c'était assez long pour préparer, donc à contresens.)
const CAPTURE_WINDOW_MS = 3 * 60 * 1000; // 3 min

// Après quelques tentatives rejetées, on espace : la file de modération n'est pas
// un stand de tir. Essais « libres » puis attente avant de pouvoir relancer.
const FREE_ATTEMPTS = 3;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 h après le dernier rejet, une fois les essais libres épuisés

// Catalogue des poses imposées. Gestes simples, sans objet, impossibles à
// deviner à l'avance et difficiles à bricoler sur une photo volée. `instruction`
// est la consigne montrée à l'écran ; `hint` précise le geste.
const POSES = [
  { code: 'main_oreille_droite', instruction: 'Pose ta main droite sur ton oreille droite', hint: 'Paume contre l’oreille, coude vers l’extérieur' },
  { code: 'main_sur_tete',       instruction: 'Pose une main à plat sur le sommet de ta tête', hint: 'La main bien visible, à plat' },
  { code: 'deux_doigts_joue',    instruction: 'Fais un « V » avec deux doigts contre ta joue', hint: 'Index et majeur écartés, posés sur la joue' },
  { code: 'paume_camera',        instruction: 'Montre ta paume ouverte face à la caméra', hint: 'Doigts écartés, à côté du visage' },
  { code: 'pouce_menton',        instruction: 'Pose ton pouce sous le menton, poing fermé', hint: 'Le poing sous le menton, pouce vers le haut' },
  { code: 'main_sur_front',      instruction: 'Pose ta main sur ton front', hint: 'Paume à plat sur le front, doigts vers le haut' },
  { code: 'index_sur_levres',    instruction: 'Pose ton index sur tes lèvres (« chut »)', hint: 'Un seul doigt, à la verticale devant la bouche' },
];

const POSE_BY_CODE = new Map(POSES.map((p) => [p.code, p]));

/** Tire une pose au hasard. `rng` injectable → tests déterministes. */
function pickPose(rng = Math.random) {
  return POSES[Math.floor(rng() * POSES.length)];
}

/** Retrouve une pose par son code (null si code inconnu). */
function poseByCode(code) {
  return POSE_BY_CODE.get(code) ?? null;
}

function captureWindowMs() {
  return CAPTURE_WINDOW_MS;
}

/** Instant de fin de la fenêtre de capture, à partir d'un instant de départ. */
function captureExpiryFrom(now = new Date()) {
  return new Date(new Date(now).getTime() + CAPTURE_WINDOW_MS).toISOString();
}

/** Vrai si la requête est en attente de selfie ET que la fenêtre de capture est passée. */
function isCaptureExpired(request, now = new Date()) {
  if (!request || request.status !== 'awaiting_selfie' || !request.capture_expires_at) return false;
  return new Date(request.capture_expires_at).getTime() < new Date(now).getTime();
}

/**
 * Peut-on ENVOYER le selfie pour cette requête ?
 * → seulement si elle attend un selfie et que la fenêtre de capture n'est pas passée.
 */
function canSubmitSelfie(request, now = new Date()) {
  if (!request) return { ok: false, reason: 'no_request' };
  if (request.status !== 'awaiting_selfie') return { ok: false, reason: 'wrong_status' };
  if (isCaptureExpired(request, now)) return { ok: false, reason: 'capture_expired' };
  return { ok: true, reason: null };
}

/** Une requête « active » occupe la place (capture en cours OU revue en attente). */
function isActiveStatus(status) {
  return status === 'awaiting_selfie' || status === 'pending_review';
}

/**
 * Peut-on DÉMARRER une nouvelle vérification, compte tenu de l'historique ?
 * `attempts` = nombre de tentatives déjà REJETÉES ; `lastRejectedAt` = date du
 * dernier rejet. Sous le seuil d'essais libres → oui, tout de suite. Au-delà →
 * il faut attendre COOLDOWN_MS après le dernier rejet.
 */
function retryPolicy({ attempts = 0, lastRejectedAt = null } = {}, now = new Date()) {
  if (attempts < FREE_ATTEMPTS || !lastRejectedAt) {
    return { canRetry: true, retryAt: null, remainingMs: 0 };
  }
  const retryAtMs = new Date(lastRejectedAt).getTime() + COOLDOWN_MS;
  const remainingMs = retryAtMs - new Date(now).getTime();
  if (remainingMs <= 0) return { canRetry: true, retryAt: null, remainingMs: 0 };
  return { canRetry: false, retryAt: new Date(retryAtMs).toISOString(), remainingMs };
}

module.exports = {
  POSES,
  CAPTURE_WINDOW_MS,
  FREE_ATTEMPTS,
  COOLDOWN_MS,
  pickPose,
  poseByCode,
  captureWindowMs,
  captureExpiryFrom,
  isCaptureExpired,
  canSubmitSelfie,
  isActiveStatus,
  retryPolicy,
};
