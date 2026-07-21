'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSION VIDÉO (serveur) — pour le workflow de création de graphe d'aventure.
//
// L'admin choisit une vidéo dans la console → on la COMPRESSE ici (ffmpeg) AVANT
// de la stocker. Même objectif qu'AfrikMoms (frontend/src/lib/videoCompression.ts,
// react-native-compressor) mais côté serveur, car la console est une page WEB :
//   · plus grand côté ramené à ~720p (≤ 1280 px), jamais d'agrandissement ;
//   · débit vidéo ~2,5 Mbit/s (bon compromis netteté/poids) ;
//   · `+faststart` : le moov atom passe AU DÉBUT du MP4 → la lecture démarre sans
//     télécharger tout le fichier (indispensable pour le préchargement fluide).
//
// Un clip 1080p/10-20 Mbit/s tombe ainsi 5-10× plus léger → préchargement rapide,
// fin des « Request aborted » sur réseau faible (la vraie cause des plantages).
//
// Le binaire ffmpeg vient de `ffmpeg-static` (livré par npm) : AUCUNE dépendance
// système à installer sur Railway.
// ─────────────────────────────────────────────────────────────────────────────
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const supabase = require('../config/supabase');

const BUCKET_AVENTURE = 'aventure'; // PUBLIC : les clips de jeu ne portent aucune identité (cf. aventurePreload).
const LONG_SIDE = 1280;             // ~720p sur le plus grand côté
const VIDEO_BITRATE = '2500k';      // ~2,5 Mbit/s
const MAX_INPUT_SIZE = 300 * 1024 * 1024; // 300 Mo garde-fou AVANT compression
const ALLOWED = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/3gpp'];

function assertVideo(file) {
  if (!file || !file.buffer) throw Object.assign(new Error('Aucune vidéo reçue'), { statusCode: 400 });
  if (!ALLOWED.includes(file.mimetype)) {
    throw Object.assign(new Error(`Format vidéo non supporté (${file.mimetype})`), { statusCode: 400 });
  }
  if (file.size > MAX_INPUT_SIZE) {
    throw Object.assign(new Error('Vidéo trop lourde (max 300 Mo avant compression)'), { statusCode: 400 });
  }
}

/**
 * Le filtre d'échelle : cap le PLUS GRAND côté à 1280 px, sans JAMAIS agrandir
 * (`min`), en gardant le ratio et des dimensions PAIRES (`-2`, requis par H.264).
 */
function scaleFilter(longSide = LONG_SIDE) {
  return `scale='if(gt(iw,ih),min(${longSide},iw),-2)':'if(gt(iw,ih),-2,min(${longSide},ih))'`;
}

/** Les arguments ffmpeg de compression — isolés pour être testés tels quels. */
function ffmpegArgs(inputPath, outputPath, { longSide = LONG_SIDE, bitrate = VIDEO_BITRATE } = {}) {
  return [
    '-y',
    '-i', inputPath,
    '-vf', scaleFilter(longSide),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', bitrate,
    '-maxrate', bitrate,
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',      // compatibilité large (iOS/Android/web)
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',  // moov atom au début → lecture progressive
    outputPath,
  ];
}

/** Lance ffmpeg (binaire statique) sur des fichiers. Rejette avec la sortie d'erreur. */
function runFfmpeg(inputPath, outputPath, opts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ffmpegArgs(inputPath, outputPath, opts));
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Compresse un buffer vidéo → renvoie le buffer compressé (MP4 720p faststart).
 * Passe par des fichiers temporaires (ffmpeg travaille sur des fichiers), nettoyés
 * dans tous les cas. Pas de fail-soft ici : si la compression échoue, on LÈVE —
 * l'admin doit le savoir plutôt que stocker un fichier lourd en silence.
 */
async function compressVideoBuffer(buffer, opts = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aventure-clip-'));
  const inputPath = path.join(dir, 'in');
  const outputPath = path.join(dir, 'out.mp4');
  try {
    await fs.writeFile(inputPath, buffer);
    await runFfmpeg(inputPath, outputPath, opts);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stocke un clip compressé dans le bucket public `aventure`. `clipId` = la clé du
 * clip dans le graphe (n1, n1_succes…). `upsert:true` : re-téléverser un clip
 * ÉCRASE l'ancien (on ré-enregistre un graphe sans accumuler des orphelins).
 * Renvoie l'URL publique — celle qu'on colle dans la table `clips` du graphe.
 */
async function uploadCompressedClip(buffer, clipId, deps = {}) {
  const client = deps.supabase || supabase;
  const safeId = String(clipId || 'clip').replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${safeId}.mp4`;
  const { data, error } = await client.storage
    .from(BUCKET_AVENTURE)
    .upload(objectPath, buffer, { contentType: 'video/mp4', upsert: true });
  if (error) throw Object.assign(new Error(`Upload échoué : ${error.message}`), { statusCode: 500 });
  const { data: pub } = client.storage.from(BUCKET_AVENTURE).getPublicUrl(data.path);
  return { clipId: safeId, url: pub.publicUrl, path: data.path };
}

/** Le workflow complet : valider → compresser → stocker → renvoyer l'URL. */
async function compressAndUploadClip(file, clipId, deps = {}) {
  assertVideo(file);
  const compressed = await compressVideoBuffer(file.buffer);
  return uploadCompressedClip(compressed, clipId, deps);
}

module.exports = {
  BUCKET_AVENTURE, LONG_SIDE, VIDEO_BITRATE, MAX_INPUT_SIZE, ALLOWED,
  assertVideo, scaleFilter, ffmpegArgs, runFfmpeg,
  compressVideoBuffer, uploadCompressedClip, compressAndUploadClip,
};
