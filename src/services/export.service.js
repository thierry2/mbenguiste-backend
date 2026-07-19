'use strict';
const supabase = require('../config/supabase');

/**
 * Export des données personnelles — droit à la portabilité (RGPD art. 20).
 *
 * Doctrine reprise d'AfrikMoms : on ne livre QUE ce que la personne a fourni ou
 * produit, jamais ce qui appartient à autrui, même dans un contenu partagé.
 * Sur une app de rencontre la règle mord plus fort qu'ailleurs — trois interdits
 * qui découlent tous du même principe :
 *
 *   1. les messages REÇUS sont les mots d'un tiers → seul `sender_id = moi` sort ;
 *   2. l'IDENTITÉ des personnes likées ou matchées ne sort jamais. Un export qui
 *      la livrerait serait un contournement complet du paywall « Qui t'a liké »,
 *      et transformerait le droit RGPD en outil de collecte ;
 *   3. `reports` / `freeform_reports` contiennent le RÉCIT d'une victime, et
 *      `blocks` la décision de quelqu'un d'autre → hors export, sans exception.
 *
 * La télémétrie (`deck_events`, `deck_impressions`, `profile_engagement`) est
 * elle aussi écartée : ce sont des mesures internes, pas des données fournies.
 */
async function exportUserData(userId) {
  const [
    { data: profil },
    { data: photos },
    { data: interets },
    { data: prompts },
    { data: preferences },
    { data: abonnements },
    { data: achats },
    { data: credits },
    { data: compteurs },
    { data: mesLikes },
    { data: matchs },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('profile_photos').select('url, position, created_at').eq('profile_id', userId).order('position'),
    supabase.from('profile_interests').select('interest:interests(code, display_name)').eq('profile_id', userId),
    supabase.from('profile_prompts').select('answer, position, prompt:prompts(question)').eq('profile_id', userId).order('position'),
    supabase.from('match_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    supabase.from('subscriptions').select('status, store, started_at, expires_at').eq('profile_id', userId),
    supabase.from('consumable_purchases').select('quantity, created_at, product:consumable_products(kind)').eq('profile_id', userId),
    supabase.from('user_credits').select('superlike_balance, boost_balance, joker_balance, updated_at').eq('profile_id', userId).maybeSingle(),
    supabase.from('usage_counters').select('kind, used, window_start').eq('profile_id', userId),
    // Mes swipes : l'action et le petit mot sont de moi — `target_id` ne sort pas.
    supabase.from('swipes').select('like_comment, like_target_type, created_at, action:swipe_actions(code, display_name)').eq('swiper_id', userId),
    supabase.from('matches').select('id, created_at, is_active, ended_at').or(`user_low.eq.${userId},user_high.eq.${userId}`),
  ]);

  // Mes messages, conversation par conversation. Le filtre `sender_id` est ce qui
  // garantit qu'aucun mot reçu ne franchit la frontière (cf. tests).
  const matchIds = (matchs || []).map((m) => m.id);
  const { data: mesMessages } = matchIds.length
    ? await supabase
        .from('messages')
        .select('match_id, body, original_body, created_at')
        .eq('sender_id', userId)
        .in('match_id', matchIds)
    : { data: [] };

  const messagesParMatch = {};
  (mesMessages || []).forEach((m) => {
    (messagesParMatch[m.match_id] ||= []).push({
      contenu: m.body,
      contenuOriginal: m.original_body ?? null,
      envoyeLe: m.created_at,
    });
  });

  return {
    genereLe: new Date().toISOString(),

    profil: profil ? {
      prenom: profil.first_name,
      email: profil.email,
      dateNaissance: profil.birth_date,
      bio: profil.bio,
      avatarUrl: profil.avatar_url,
      villeActuelle: profil.current_city,
      paysActuel: profil.current_country,
      origine: profil.origin_country,
      metier: profil.occupation,
      taille: profil.height_cm,
      languePrincipale: profil.primary_language,
      langues: profil.spoken_languages ?? [],
      modeDeVie: profil.lifestyle ?? {},
      estVerifie: profil.is_verified,
      estPremium: profil.is_premium,
      premiumJusquau: profil.premium_until ?? null,
      compteCreeLe: profil.created_at,
      reglages: {
        notifPush: profil.notif_push,
        notifEmail: profil.notif_email,
        visibleDansDecouverte: profil.is_discoverable,
        incognito: profil.incognito,
        masquerEnLigne: profil.hide_online_status,
      },
      suppressionProgrammeeLe: profil.scheduled_deletion_at ?? null,
    } : null,

    photos: (photos || []).map((p) => ({
      url: p.url, position: p.position, ajouteeLe: p.created_at,
    })),

    centresInteret: (interets || []).map((i) => i.interest?.display_name).filter(Boolean),

    prompts: (prompts || []).map((p) => ({
      question: p.prompt?.question ?? null, reponse: p.answer,
    })),

    preferences: preferences ? {
      ageMin: preferences.min_age,
      ageMax: preferences.max_age,
      regions: preferences.regions ?? [],
      langueCommuneRequise: preferences.require_common_language,
      photosMinimum: preferences.min_photos,
      bioRequise: preferences.require_bio,
      profilsVerifiesSeulement: preferences.verified_only,
    } : null,

    abonnements: (abonnements || []).map((a) => ({
      statut: a.status, boutique: a.store, debuteLe: a.started_at, expireLe: a.expires_at,
    })),

    achats: (achats || []).map((a) => ({
      type: a.product?.kind ?? null, quantite: a.quantity, acheteLe: a.created_at,
    })),

    credits: credits ? {
      superLikes: credits.superlike_balance,
      boosts: credits.boost_balance,
      jokers: credits.joker_balance,
      misAJourLe: credits.updated_at,
    } : null,

    compteursUtilisation: (compteurs || []).map((c) => ({
      type: c.kind, utilises: c.used, depuisLe: c.window_start,
    })),

    // Mes likes/passes : mon geste et mes mots, jamais QUI était en face.
    mesLikesEnvoyes: (mesLikes || []).map((s) => ({
      action: s.action?.code ?? null,
      cibleDuLike: s.like_target_type ?? null,
      motJoint: s.like_comment ?? null,
      envoyeLe: s.created_at,
    })),

    // Mes matchs : l'existence et les dates, jamais l'identité du partenaire.
    mesMatchs: (matchs || []).map((m) => ({
      matchId: m.id, matcheLe: m.created_at, actif: m.is_active, termineLe: m.ended_at ?? null,
    })),

    // Uniquement mes propres messages envoyés — jamais ceux de l'autre personne.
    mesMessagesEnvoyes: matchIds
      .map((id) => ({ matchId: id, messages: messagesParMatch[id] ?? [] }))
      .filter((c) => c.messages.length > 0),
  };
}

module.exports = { exportUserData };
