/**
 * CALIBRATION du masque « héros » (carte Mystère plein écran).
 *
 *   node scripts/calibrate-hero-blur.js <url-ou-chemin-d-une-photo>
 *
 * Pourquoi cet outil existe : le masque de la grille Likes (220×300, sigma 20)
 * est illisible une fois étalé en plein écran — la carte n'agrandit pas moins,
 * elle agrandit ~7× au lieu de ~2×, donc le même flou devient trois fois plus
 * épais à l'œil. Il faut une seconde variante, plus grande et moins floutée.
 *
 * MAIS « moins floutée » est un ARBITRAGE, pas un calcul : c'est la même
 * information, on choisit combien on en laisse passer. Et comme le fichier vit
 * sur un bucket PUBLIC, il doit être sûr TOUT SEUL — le flou client ne compte
 * pas dans la sécurité. Donc on regarde, on juge, on tranche. Pas d'estimation
 * au doigt mouillé.
 *
 * Le script écrit les variantes dans `tmp/hero-blur/`. Les REGARDER EN PLEIN
 * ÉCRAN SUR UN TÉLÉPHONE (les envoyer sur le sien) : jugées sur un écran
 * d'ordinateur en petit, elles paraîtront toutes plus sûres qu'elles ne sont.
 *
 * Le bon choix est la variante la plus nette qui coche ENCORE les trois cases :
 *   • on voit une silhouette : tête, épaules, teint, cadrage ;
 *   • on ne peut PAS décrire le visage (yeux, nez, bouche, expression) ;
 *   • on ne reconnaîtrait pas quelqu'un qu'on connaît bien.
 * Au moindre doute sur la troisième, prendre la variante d'AVANT.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Format de la variante héros : proche du ratio d'un téléphone (moins de
// rognage et surtout bien moins d'agrandissement que le 220×300 de la grille).
const HERO_W = 720;
const HERO_H = 1280;

// Les sigmas à comparer. Repère : la grille Likes est à 20 sur 220 px de large,
// soit un rapport de 0,091. Ici la largeur est 3,3× plus grande, donc à rapport
// ÉGAL il faudrait sigma ≈ 65 — ce serait aussi illisible qu'aujourd'hui. Toute
// valeur en dessous laisse passer plus de forme, et plus de risque.
const SIGMAS = [26, 34, 42, 52, 65];

async function source(arg) {
  if (/^https?:\/\//.test(arg)) {
    const res = await fetch(arg);
    if (!res.ok) throw new Error(`Téléchargement échoué (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFileSync(arg);
}

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage : node scripts/calibrate-hero-blur.js <url-ou-chemin>');
    console.error("Astuce : n'importe quel `url` de la table profile_photos fait l'affaire.");
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), 'tmp', 'hero-blur');
  fs.mkdirSync(outDir, { recursive: true });

  const src = await source(arg);

  // Témoin : le masque ACTUEL, agrandi à la taille héros. C'est ce que tu as
  // sous les yeux aujourd'hui — la référence à battre.
  const actuel = await sharp(src)
    .rotate().resize(220, 300, { fit: 'cover' }).blur(20)
    .resize(HERO_W, HERO_H, { fit: 'cover' })
    .jpeg({ quality: 82 }).toBuffer();
  fs.writeFileSync(path.join(outDir, '0-actuel-grille-agrandie.jpg'), actuel);
  console.log('  ✓ 0-actuel-grille-agrandie.jpg   (ce que tu vois aujourd\'hui)');

  for (const sigma of SIGMAS) {
    const out = await sharp(src)
      .rotate()
      .resize(HERO_W, HERO_H, { fit: 'cover' })
      .blur(sigma)
      .modulate({ saturation: 1.06 })
      .jpeg({ quality: 82 })
      .toBuffer();
    const nom = `hero-sigma-${String(sigma).padStart(2, '0')}.jpg`;
    fs.writeFileSync(path.join(outDir, nom), out);
    const rapport = (sigma / HERO_W).toFixed(4);
    console.log(`  ✓ ${nom}   sigma ${sigma} — rapport ${rapport}${sigma === 65 ? '  (= sécurité actuelle)' : ''}`);
  }

  console.log(`\nVariantes écrites dans ${outDir}`);
  console.log('Les regarder EN PLEIN ÉCRAN SUR UN TÉLÉPHONE, puis reporter le');
  console.log('sigma retenu dans HERO_SIGMA (src/services/mask.service.js).');
})();
