'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// MODÈLE GRAPHES — l'I/O Supabase des graphes d'Aventure (service_role) + un
// CACHE SYNCHRONE pour la résolution.
//
// La résolution serveur (`aventure.service`) a besoin du graphe SANS `await`
// (elle tranche dans une passe synchrone). On garde donc les graphes en mémoire,
// rafraîchis depuis la BD au démarrage (server.js) et après chaque
// enregistrement admin. `grapheRuntime` renvoie le graphe en BD s'il existe,
// sinon REPLI sur le graphe en dur (`domain/aventureGraphe`) : tant qu'aucun
// graphe n'est enregistré, le comportement ne change pas.
// ─────────────────────────────────────────────────────────────────────────────
const supabase = require('../config/supabase');
const codeGraphe = require('../domain/aventureGraphe');

const _cache = new Map();

/** Recharge tous les graphes de la BD en mémoire. Appelé au démarrage + après save. */
async function refreshCache() {
  const { data } = await supabase.from('aventure_graphs').select('id, data');
  _cache.clear();
  for (const row of data || []) _cache.set(row.id, row.data);
  return _cache.size;
}

/** Le graphe pour la RÉSOLUTION (sync) : BD si chargé, sinon repli sur le code. */
function grapheRuntime(id) {
  return _cache.get(id) || codeGraphe.graphe(id);
}

async function listGraphs() {
  const { data } = await supabase
    .from('aventure_graphs').select('id, title, updated_at').order('id');
  return data || [];
}

async function getGraph(id) {
  const { data } = await supabase
    .from('aventure_graphs').select('id, title, data, updated_at').eq('id', id).maybeSingle();
  return data || null;
}

/** Upsert un graphe, puis rafraîchit le cache (le runtime le voit tout de suite). */
async function saveGraph(id, { title, data }) {
  const { error } = await supabase
    .from('aventure_graphs')
    .upsert({ id, title: title ?? null, data, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw error;
  await refreshCache();
  return getGraph(id);
}

module.exports = { refreshCache, grapheRuntime, listGraphs, getGraph, saveGraph, _cache };
