const config = require('../config');

/**
 * Autocomplete des villes via GeoNames (gratuit, ~20k crédits/jour).
 * Proxy côté serveur : username caché, cache mémoire (les mêmes préfixes reviennent
 * sans cesse : « Dou », « Dak », « Abi »…), et fail-open — toute erreur renvoie []
 * pour que le front bascule en saisie libre sans jamais bloquer l'utilisateur.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // les villes ne bougent pas : 24 h
const CACHE_MAX    = 2000;                // ~quelques Mo max, éviction FIFO
const cache = new Map();                  // clé `${iso}:${q}` → { at, items }

function _fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.items;
}

function _toCache(key, items) {
  if (cache.size >= CACHE_MAX) {
    // Éviction du plus ancien (Map préserve l'ordre d'insertion).
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), items });
}

/**
 * @param {string} countryIso ISO 3166-1 alpha-2 (ex. 'CM') — '' = monde entier
 * @param {string} q          préfixe du nom de ville (min 2 caractères)
 * @returns {Promise<{ name, region, countryCode, countryName }[]>}
 */
async function searchCities(countryIso, q) {
  const query = (q ?? '').trim();
  if (query.length < 2) return [];
  if (!config.geonames.username) {
    console.warn('[geo] GEONAMES_USERNAME non défini → autocomplete villes désactivé (saisie libre côté app)');
    return [];
  }

  const iso = (countryIso ?? '').trim().toUpperCase();
  const key = `${iso}:${query.toLowerCase()}`;
  const cached = _fromCache(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    name_startsWith: query,
    featureClass: 'P',        // populated places uniquement (villes, villages)
    maxRows: '8',
    lang: 'fr',
    orderby: 'population',    // les grandes villes d'abord
    username: config.geonames.username,
  });
  if (iso) params.set('country', iso);

  try {
    const res = await fetch(`https://secure.geonames.org/searchJSON?${params}`, {
      signal: AbortSignal.timeout(4000), // l'autocomplete doit rester vif ; au-delà → saisie libre
    });
    if (!res.ok) return [];
    const data = await res.json();
    // GeoNames renvoie ses erreurs en HTTP 200 avec un objet `status` (compte non
    // activé pour les webservices, quota horaire dépassé…) — à logguer clairement,
    // et surtout NE PAS mettre en cache (sinon 24 h de résultats vides à tort).
    if (data.status) {
      console.error(`[geo] GeoNames erreur ${data.status.value}: ${data.status.message}`);
      return [];
    }
    // Dédoublonnage par nom + pays (GeoNames renvoie quartiers/homonymes distincts ;
    // en recherche monde entier, un même nom peut légitimement exister dans
    // plusieurs pays — San José, Bertoua/Bertua… — on les garde alors tous).
    const seen = new Set();
    const items = (data.geonames ?? [])
      .map((g) => ({
        name:        g.name,
        region:      g.adminName1   || null,
        countryCode: g.countryCode  || null, // ISO2 → permet au front de pré-remplir le pays
        countryName: g.countryName  || null, // libellé FR GeoNames (repli si ISO inconnu)
      }))
      .filter((c) => {
        if (!c.name) return false;
        const k = `${c.name.toLowerCase()}|${c.countryCode ?? ''}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
    _toCache(key, items);
    return items;
  } catch (e) {
    console.error('[geo] searchCities:', e?.message);
    return [];
  }
}

module.exports = { searchCities };
