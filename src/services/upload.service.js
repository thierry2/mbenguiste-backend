const supabase = require('../config/supabase');

// Buckets (créés par db/migrations/002_storage_and_media.sql).
const BUCKET_PHOTOS = 'photos';      // PUBLIC : photos de profil, visibles en découverte.
const BUCKET_CHAT   = 'chat-media';  // PRIVÉ  : images de messages, servies via URL signée.

const CHAT_SIGNED_URL_TTL = 60 * 60; // 1 h — une URL qui fuite expire vite.

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_SIZE = MAX_IMAGE_SIZE;       // garde-fou dur pour multer (voir routes).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function assertImage(file) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    throw Object.assign(new Error('Format non supporté (jpeg, png, webp)'), { statusCode: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw Object.assign(new Error('Image trop lourde (max 10 Mo)'), { statusCode: 400 });
  }
}

function ext(mimetype) {
  return mimetype.split('/')[1].replace('jpeg', 'jpg');
}

/**
 * Photo de profil → bucket PUBLIC. Renvoie l'URL publique (affichée partout).
 * Le dossier commence par l'uid → la policy Storage n'autorise que le propriétaire.
 */
async function uploadProfilePhoto(file, userId) {
  assertImage(file);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext(file.mimetype)}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_PHOTOS)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw Object.assign(new Error(`Upload échoué : ${error.message}`), { statusCode: 500 });

  const { data: pub } = supabase.storage.from(BUCKET_PHOTOS).getPublicUrl(data.path);
  return { url: pub.publicUrl };
}

/**
 * Image de message → bucket PRIVÉ. Renvoie le CHEMIN (jamais d'URL publique) ;
 * la lecture se fait via une URL signée temporaire (signChatUrl).
 */
async function uploadChatImage(file, userId) {
  assertImage(file);
  const path = `${userId}/${new Date().getFullYear()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext(file.mimetype)}`;

  const { data, error } = await supabase.storage
    .from(BUCKET_CHAT)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw Object.assign(new Error(`Upload échoué : ${error.message}`), { statusCode: 500 });

  return { path: data.path, type: 'image' };
}

/** Signe un chemin de média de chat → URL temporaire (ou null). */
async function signChatUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET_CHAT).createSignedUrl(path, CHAT_SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Signe plusieurs chemins en un appel (liste de messages). Renvoie une Map path→url. */
async function signChatUrls(paths) {
  const toSign = [...new Set(paths.filter(Boolean))];
  const map = new Map();
  if (!toSign.length) return map;
  const { data } = await supabase.storage.from(BUCKET_CHAT).createSignedUrls(toSign, CHAT_SIGNED_URL_TTL);
  (data || []).forEach((d) => { if (d.signedUrl && !d.error) map.set(d.path, d.signedUrl); });
  return map;
}

module.exports = {
  MAX_UPLOAD_SIZE,
  uploadProfilePhoto,
  uploadChatImage,
  signChatUrl,
  signChatUrls,
};
