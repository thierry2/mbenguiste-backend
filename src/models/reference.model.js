const supabase = require('../config/supabase');

// Cache mémoire simple des tables de référence (immuables en pratique).
// Évite un aller-retour DB à chaque swipe / résolution de code.
const cache = new Map();

// Colonnes par table quand le défaut ne colle pas. swipe_actions n'a PAS de
// display_order (cf. schema.sql : id, code, display_name) — la sélectionner
// faisait échouer TOUS les swipes en 500 (« column does not exist »).
const COLUMNS = {
  swipe_actions: 'id, code, display_name',
};

async function loadTable(table, columns = COLUMNS[table] ?? 'id, code, display_name, display_order') {
  if (cache.has(table)) return cache.get(table);
  let query = supabase.from(table).select(columns);
  // On ne trie que si la colonne est demandée (donc existante sur la table).
  if (columns.includes('display_order')) {
    query = query.order('display_order', { ascending: true });
  }
  const { data, error } = await query;
  if (error) throw error;
  cache.set(table, data || []);
  return data || [];
}

async function idForCode(table, code) {
  const rows = await loadTable(table);
  return rows.find((r) => r.code === code)?.id ?? null;
}

/** Toutes les listes nécessaires à l'onboarding (front). */
async function bootstrap() {
  const [genders, goals, interests, prompts, plans, reportReasons, lifestyleRows, consumables] = await Promise.all([
    loadTable('genders'),
    loadTable('relationship_goals'),
    loadTable('interests', 'id, code, display_name, category, display_order'),
    loadTable('prompts', 'id, code, question, display_order'),
    loadTable('subscription_plans', 'id, code, store_product_id, display_name, tier, period, months, price_eur, display_order'),
    loadTable('report_reasons'),
    loadTable('lifestyle_options', 'kind, code, display_name, display_order'),
    loadTable('consumable_products', 'id, code, store_product_id, kind, quantity, price_eur, display_order'),
  ]);

  // Descripteurs mode de vie groupés par type ({astro:[{code,label}], …}).
  const lifestyle = {};
  for (const o of lifestyleRows) {
    (lifestyle[o.kind] ||= []).push({ code: o.code, label: o.display_name });
  }

  return {
    genres: genders.map((g) => ({ id: g.id, code: g.code, label: g.display_name })),
    objectifs: goals.map((g) => ({ id: g.id, code: g.code, label: g.display_name })),
    interets: interests.map((i) => ({ id: i.id, code: i.code, label: i.display_name, categorie: i.category })),
    prompts: prompts.map((p) => ({ id: p.id, code: p.code, question: p.question })),
    plans: plans.map((p) => ({
      id: p.id, code: p.code, storeProductId: p.store_product_id ?? null, label: p.display_name,
      palier: p.tier, periode: p.period, mois: p.months, prixEur: Number(p.price_eur),
    })),
    motifsSignalement: reportReasons.map((r) => ({ id: r.id, code: r.code, label: r.display_name })),
    lifestyle,
    consommables: consumables.map((c) => ({
      id: c.id, code: c.code, storeProductId: c.store_product_id, kind: c.kind,
      quantite: c.quantity, prixEur: Number(c.price_eur),
    })),
  };
}

module.exports = { loadTable, idForCode, bootstrap };
