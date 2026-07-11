const supabase = require('../config/supabase');

// Cache mémoire simple des tables de référence (immuables en pratique).
// Évite un aller-retour DB à chaque swipe / résolution de code.
const cache = new Map();

async function loadTable(table, columns = 'id, code, display_name, display_order') {
  if (cache.has(table)) return cache.get(table);
  const { data, error } = await supabase
    .from(table).select(columns).order('display_order', { ascending: true });
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
  const [genders, goals, interests, prompts, plans, reportReasons] = await Promise.all([
    loadTable('genders'),
    loadTable('relationship_goals'),
    loadTable('interests', 'id, code, display_name, category, display_order'),
    loadTable('prompts', 'id, code, question, display_order'),
    loadTable('subscription_plans', 'id, code, display_name, months, price_eur, display_order'),
    loadTable('report_reasons'),
  ]);
  return {
    genres: genders.map((g) => ({ id: g.id, code: g.code, label: g.display_name })),
    objectifs: goals.map((g) => ({ id: g.id, code: g.code, label: g.display_name })),
    interets: interests.map((i) => ({ id: i.id, code: i.code, label: i.display_name, categorie: i.category })),
    prompts: prompts.map((p) => ({ id: p.id, code: p.code, question: p.question })),
    plans: plans.map((p) => ({ id: p.id, code: p.code, label: p.display_name, mois: p.months, prixEur: Number(p.price_eur) })),
    motifsSignalement: reportReasons.map((r) => ({ id: r.id, code: r.code, label: r.display_name })),
  };
}

module.exports = { loadTable, idForCode, bootstrap };
