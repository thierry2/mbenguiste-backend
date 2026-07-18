const supabase = require('../config/supabase');

/**
 * Accès aux dossiers de modération pour la console admin. Lecture seule sur les
 * signalements, plus deux gestes réversibles sur le profil visé (retirer de la
 * découverte / restaurer).
 *
 * Volontairement SANS suppression de compte : c'est irréversible, et rien dans
 * une console protégée par un simple secret partagé ne devrait pouvoir effacer
 * quelqu'un. La suppression passe par le flux de compte existant, à la main.
 */

/** Signalements (par défaut ouverts) + profils visés, pour la mise en dossiers. */
async function listReportsWithProfiles(statut = 'open') {
  let query = supabase
    .from('reports')
    .select('id, reported_id, reporter_id, details, status, created_at, reason:report_reasons(code, display_name)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (statut && statut !== 'all') query = query.eq('status', statut);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map((r) => ({
    id: r.id,
    reported_id: r.reported_id,
    reporter_id: r.reporter_id,
    reason_code: r.reason?.code ?? 'other',
    reason_label: r.reason?.display_name ?? 'Autre chose',
    details: r.details,
    status: r.status,
    created_at: r.created_at,
  }));

  const ids = [...new Set(rows.map((r) => r.reported_id))];
  let profilesById = new Map();
  if (ids.length) {
    const { data: profs, error: e2 } = await supabase
      .from('profiles')
      .select('id, first_name, avatar_url, is_discoverable')
      .in('id', ids);
    if (e2) throw e2;
    profilesById = new Map((profs || []).map((p) => [p.id, {
      id: p.id,
      prenom: p.first_name,
      avatarUrl: p.avatar_url ?? null,
      estRetire: p.is_discoverable === false,
    }]));
  }

  return { rows, profilesById };
}

/** Dossiers libres (« son profil n'apparaît pas ici ») — texte brut, à lire. */
async function listFreeformReports(statut = 'open') {
  let query = supabase
    .from('freeform_reports')
    .select('id, body, status, admin_note, treated_at, created_at, reporter:profiles!reporter_id(id, first_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (statut && statut !== 'all') query = query.eq('status', statut);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((f) => ({
    id: f.id,
    texte: f.body,
    statut: f.status,
    note: f.admin_note ?? null,
    traiteLe: f.treated_at ?? null,
    le: f.created_at,
    // Le dossier libre n'est PAS anonyme côté équipe : sans le prénom de qui
    // écrit, impossible de recouper avec ses matchs pour retrouver la personne
    // décrite. C'est tout l'objet de ce formulaire.
    signalantePrenom: f.reporter?.first_name ?? null,
  }));
}

/** Clôt d'un coup tous les signalements ouverts visant ce profil. */
async function closeReportsFor(profileId, statut, note, action) {
  const { error } = await supabase
    .from('reports')
    .update({
      status: statut,
      admin_note: note,
      admin_action: action,
      treated_at: new Date().toISOString(),
    })
    .eq('reported_id', profileId)
    .eq('status', 'open');
  if (error) throw error;
}

async function closeFreeformReport(id, note, action) {
  const { error } = await supabase
    .from('freeform_reports')
    .update({
      status: 'closed',
      admin_note: note,
      admin_action: action,
      treated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
}

/** Annule un retrait (auto ou manuel) — le profil revient dans la découverte. */
async function restoreToDiscovery(profileId) {
  const { error } = await supabase
    .from('profiles')
    .update({ is_discoverable: true, updated_at: new Date().toISOString() })
    .eq('id', profileId);
  if (error) throw error;
}

/** Compteurs du bandeau de la console (file d'attente réelle). */
async function counts() {
  const [reports, freeform] = await Promise.all([
    supabase.from('reports').select('reported_id', { count: 'exact', head: false }).eq('status', 'open'),
    supabase.from('freeform_reports').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ]);
  if (reports.error) throw reports.error;
  if (freeform.error) throw freeform.error;
  return {
    dossiers: new Set((reports.data || []).map((r) => r.reported_id)).size,
    signalements: (reports.data || []).length,
    dossiersLibres: freeform.count ?? 0,
  };
}

module.exports = {
  listReportsWithProfiles, listFreeformReports,
  closeReportsFor, closeFreeformReport, restoreToDiscovery, counts,
};
