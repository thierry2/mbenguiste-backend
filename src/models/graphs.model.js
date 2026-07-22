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
const { choisirGraphe } = require('../domain/grapheChoix');
const { validerGraphe } = require('../domain/aventure');

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

/**
 * LE SCÉNARIO D'UNE PAIRE — dérivé de son id (cf. domain/grapheChoix), donc
 * identique partout sans rien stocker. Renvoie { id, start }, ou null si aucun
 * graphe jouable n'est en BD. Serveur-autoritaire : le client ne choisit jamais.
 *
 * Remplace l'ancien tirage `Math.random()` : l'onglet Mystère précharge les
 * clips AVANT que la session existe, il doit donc pouvoir calculer le MÊME
 * résultat que la création de session — sinon il précharge le mauvais scénario
 * et on retombe sur le buffering que le préchargement devait supprimer.
 *
 * Un graphe sans `start` ni `nodes` est ÉCARTÉ : un brouillon enregistré dans
 * l'admin ne doit pas pouvoir tomber sur quelqu'un.
 */
async function grapheDePaire(pairId) {
  const { data } = await supabase.from('aventure_graphs').select('id, data');
  // DÉFENSE EN PROFONDEUR : on ne sert QU'un graphe VALIDE. L'admin valide déjà à
  // l'écriture (route PUT), mais un graphe entré autrement (SQL direct, legacy
  // d'avant la validation) ne doit JAMAIS tomber sur une paire — une flèche vers
  // un nœud inexistant figerait l'aventure au premier pas. `validerGraphe` est
  // pur et bon marché (une poignée de scénarios) : on peut le passer à chaque tirage.
  const jouables = (data || []).filter(
    (r) => r.data && r.data.start && r.data.nodes && validerGraphe(r.data).length === 0,
  );
  if (!jouables.length) return null;
  const id = choisirGraphe(jouables.map((r) => r.id), pairId);
  const row = jouables.find((r) => r.id === id);
  return row ? { id: row.id, start: row.data.start } : null;
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

module.exports = { refreshCache, grapheRuntime, grapheDePaire, listGraphs, getGraph, saveGraph, _cache };
