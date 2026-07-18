const crypto = require('crypto');
const sharp = require('sharp');
const supabase = require('../config/supabase');

// Génère la version FLOUTÉE d'une photo de profil et la stocke dans le bucket
// public `photos`, à un chemin ALÉATOIRE (jamais sous <userId>/… → l'URL ne
// trahit pas l'identité). On sert cette image dans les contextes masqués
// (« qui t'a liké », aventures) ; l'originale ne part jamais au client là-bas.
//
// Sécurité du flou (⚠ relire AVANT de toucher aux réglages de `blur()`) : le
// masque n'est PLUS le downscale ~40 px d'origine — il a été desserré à 220 px
// pour le rendu, et l'ancien argument « le downscale détruit l'information »
// ne décrit donc plus ce code. Ce qui rend aujourd'hui le visage non
// identifiable, c'est le gaussien sigma 20 SUR une image de 220 px de large :
// le noyau déborde sur plus d'un quart de la largeur, et la quantification
// JPEG achève les hautes fréquences. Adoucir ce couple (agrandir la taille OU
// baisser le sigma) rendrait des visages reconnaissables.
//
// Ce masque est la PREMIÈRE de deux couches indépendantes. L'écran Mystère
// ajoute par-dessus un flou client qui ne descend jamais sous un plancher —
// voir `frontend/src/lib/mystereReveal.ts`, dont les tests verrouillent ce
// plancher. L'indépendance est voulue : desserrer une couche ne suffit pas à
// créer une fuite. Ce n'est pas une invitation à desserrer celle-ci.
const BUCKET = 'photos';
const PUBLIC_MARKER = '/object/public/photos/';

function pathFromPublicUrl(url) {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_MARKER);
  return i === -1 ? null : url.slice(i + PUBLIC_MARKER.length);
}

/** Récupère les octets de la source (photo du bucket OU URL externe, ex. seed Unsplash). */
async function fetchImageBuffer(url) {
  const path = pathFromPublicUrl(url);
  if (path) {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement source échoué (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function blur(buffer) {
  // Flou LISSE haute résolution (façon Yamo/Tinder) : on garde ~220px — assez pour
  // sentir une vraie photo (teint, tenue, silhouette) — mais un fort Gaussien rend
  // le visage NON identifiable. Bien plus joli que l'ancien 40px pâteux.
  return sharp(buffer)
    .rotate() // respecte l'orientation EXIF
    .resize(220, 300, { fit: 'cover' })
    .blur(20) // Gaussien fort → visage illisible, rendu lisse
    .modulate({ saturation: 1.06 }) // garde les couleurs vivantes
    .jpeg({ quality: 76 })
    .toBuffer();
}

/**
 * Produit + stocke la version floutée d'une photo → renvoie son URL publique
 * (ou null si la source est illisible — l'appelant retombe sur le placeholder).
 */
async function makeMaskedUrl(sourceUrl) {
  const src = await fetchImageBuffer(sourceUrl);
  const out = await blur(src);
  const path = `masked/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, out, { contentType: 'image/jpeg', upsert: false });
  if (error) throw Object.assign(new Error(`Stockage flou échoué : ${error.message}`), { statusCode: 500 });
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

module.exports = { makeMaskedUrl };
