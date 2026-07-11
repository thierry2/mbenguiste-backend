// Grandes régions de découverte — remplacent la « distance » (Mbenguiste est
// mondial). Le front n'envoie que les codes ; on les étend ici en listes de pays
// (ISO alpha-2) pour filtrer la requête. Couvre le jeu curé de countries.ts + un
// peu de marge pour les ajouts futurs.
const REGIONS = {
  africa: [
    'CI', 'CM', 'SN', 'ML', 'CD', 'CG', 'GA', 'GN', 'BJ', 'TG', 'BF', 'NG', 'GH',
    'MA', 'DZ', 'TN', 'KE', 'ET', 'UG', 'TZ', 'RW', 'CV', 'MR', 'NE', 'TD', 'AO',
    'ZA', 'CF', 'LY', 'EG', 'BI', 'SL', 'LR', 'GM', 'GW', 'GQ',
  ],
  europe: [
    'FR', 'BE', 'CH', 'GB', 'DE', 'IT', 'ES', 'PT', 'NL', 'LU', 'IE', 'AT', 'SE',
    'NO', 'DK', 'FI', 'PL', 'GR',
  ],
  americas: ['CA', 'US', 'BR', 'MX', 'AR', 'CL', 'CO', 'HT'],
};

/** Étend une liste de codes région en liste de pays (dédupliquée). */
function countriesForRegions(regionCodes) {
  const set = new Set();
  for (const code of regionCodes || []) {
    (REGIONS[code] || []).forEach((c) => set.add(c));
  }
  return [...set];
}

module.exports = { REGIONS, countriesForRegions };
