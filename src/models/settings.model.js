'use strict';
const supabase = require('../config/supabase');

// ─────────────────────────────────────────────────────────────────────────────
// Réglages à chaud (app_settings) — lecture en CASCADE de sécurité :
//   app_settings (BD)  →  défaut fourni par l'appelant  →  clamp de bornes.
// Cache mémoire à TTL court : un UPDATE en base se propage en ~60 s sans
// requêter la table à chaque deck. Fail-soft absolu : une valeur manquante,
// aberrante, ou une DB en panne retombent sur le défaut — le deck ne casse jamais.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60_000;

/** Factory testable (store + horloge injectés). */
function createSettings({ store, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  let cache = null;       // { [key]: value }
  let loadedAt = -Infinity;

  async function all() {
    if (cache && now() - loadedAt < ttlMs) return cache;
    try {
      cache = await store.fetchAll();
      loadedAt = now();
    } catch {
      // DB en panne : on garde le dernier cache s'il existe, sinon vide (→ défauts).
      if (!cache) cache = {};
    }
    return cache;
  }

  /** Nombre borné : défaut si absent/non-numérique, clamp {min,max} optionnel. */
  async function getNumber(key, def, { min, max } = {}) {
    const rows = await all();
    const raw = rows[key];
    let n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) n = def;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    return n;
  }

  /** Booléen : défaut si absent/non-booléen. */
  async function getBool(key, def) {
    const rows = await all();
    const raw = rows[key];
    return typeof raw === 'boolean' ? raw : def;
  }

  return { getNumber, getBool };
}

// ── Store Supabase (service_role bypass RLS) ─────────────────────────────────
const supabaseStore = {
  async fetchAll() {
    const { data, error } = await supabase.from('app_settings').select('key, value');
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  },
};

const defaultSettings = createSettings({ store: supabaseStore });

module.exports = {
  createSettings,
  getNumber: defaultSettings.getNumber,
  getBool: defaultSettings.getBool,
};
