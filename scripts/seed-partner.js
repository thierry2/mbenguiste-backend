/**
 * Seed PARTENAIRE — un partenaire complet avec ses filleuls et ses commissions.
 *
 *   node scripts/seed-partner.js
 *
 * Crée (idempotent, relançable) :
 *   1. le compte Supabase du partenaire AVEC MOT DE PASSE (email_confirm: true)
 *      → AUCUN email envoyé : ne consomme pas le quota Supabase, et le partenaire
 *        peut se connecter tout de suite sur /partenaires ;
 *   2. sa fiche `partners` (Fondateur, 40 %) + son code promo ;
 *   3. N filleuls (comptes + profils) rattachés à son code ;
 *   4. des abonnements sur une partie d'entre eux + les commissions
 *      correspondantes, réparties sur les TROIS états du tableau de bord
 *      (en attente / validé / versé) pour que l'écran soit vraiment lisible.
 *
 * Les montants sont calculés par le VRAI moteur (src/domain/commission) : les
 * chiffres affichés sont donc ceux que produirait la production.
 *
 * Réglages (env) :
 *   PARTNER_NAME, PARTNER_EMAIL, PARTNER_CODE, PARTNER_RATE_BPS,
 *   PARTNER_PASSWORD, REFERRALS (défaut 300), SUBSCRIBERS (défaut 48)
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY et la migration 028.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const logger = require('../src/utils/logger');
const { computeCommission } = require('../src/domain/commission');

const NAME = process.env.PARTNER_NAME || 'bovan';
const EMAIL = (process.env.PARTNER_EMAIL || 'bovan@gmail.com').trim().toLowerCase();
const CODE = (process.env.PARTNER_CODE || 'BOVAN').trim().toUpperCase();
const RATE_BPS = parseInt(process.env.PARTNER_RATE_BPS || '4000', 10);
const PASSWORD = process.env.PARTNER_PASSWORD || 'Bovan!2026';
const N_REFERRALS = Math.max(0, parseInt(process.env.REFERRALS || '300', 10));
const N_SUBSCRIBERS = Math.max(0, parseInt(process.env.SUBSCRIBERS || '48', 10));

const CONCURRENCE = 6;          // créations de comptes en parallèle
const JOUR = 24 * 60 * 60 * 1000;

// Prix réels du catalogue (doctrine des offres).
const PLANS = [
  { tier: 'plus', price: 8.99 },
  { tier: 'or', price: 11.99 },
  { tier: 'or', price: 11.99 },      // l'Or est le héros : sur-représenté
  { tier: 'prestige', price: 19.99 },
];

const PRENOMS = ['Awa', 'Fatou', 'Aminata', 'Grâce', 'Mariam', 'Nadia', 'Chloé', 'Sarah', 'Ines', 'Rokia',
  'Koffi', 'Ibrahim', 'Moussa', 'Julien', 'Thomas', 'David', 'Kwame', 'Malick', 'Yann', 'Serge'];

// PRNG déterministe : relancer le seed ne fait pas « bouger » les données.
const rng = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Compte Auth : réutilisé s'il existe déjà (recherche par profil, puis par listUsers). */
async function ensureAuthUser(email, password) {
  const { data: prof } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
  if (prof?.id) return prof.id;

  const { data: cree, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,      // confirmé d'office → AUCUN email
  });
  if (!error && cree?.user?.id) return cree.user.id;

  for (let page = 1; page <= 40; page += 1) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const u = list?.users?.find((x) => String(x.email).toLowerCase() === email);
    if (u) return u.id;
    if (!list?.users?.length || list.users.length < 200) break;
  }
  return null;
}

/** Exécute `tache` sur chaque élément, `limite` en parallèle. */
async function enParallele(items, limite, tache) {
  const resultats = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (index < items.length) {
      const i = index; index += 1;
      resultats[i] = await tache(items[i], i);
    }
  }));
  return resultats;
}

async function main() {
  const t0 = Date.now();

  // ── 1. Le partenaire ───────────────────────────────────────────────────────
  logger.info(`Partenaire « ${NAME} » (${EMAIL})…`);
  const authUserId = await ensureAuthUser(EMAIL, PASSWORD);
  if (!authUserId) throw new Error("Impossible de créer/retrouver le compte Supabase du partenaire");

  const { data: partenaire, error: pErr } = await supabase
    .from('partners')
    .upsert({
      display_name: NAME,
      email: EMAIL,
      rate_bps: RATE_BPS,
      is_founder: true,
      status: 'active',
      auth_user_id: authUserId,
      activated_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    .select('id, display_name, email, rate_bps')
    .single();
  if (pErr) throw pErr;

  const { error: cErr } = await supabase
    .from('promo_codes')
    .upsert({ code: CODE, partner_id: partenaire.id, is_active: true }, { onConflict: 'code' });
  if (cErr) throw cErr;
  logger.info(`  fiche + code ${CODE} OK (id ${partenaire.id})`);

  // ── 2. Les filleuls ────────────────────────────────────────────────────────
  logger.info(`Création de ${N_REFERRALS} filleuls (comptes + profils)…`);
  const { data: genresRef } = await supabase.from('genders').select('id, code');
  const genres = new Map((genresRef || []).map((g) => [g.code, g.id]));

  const indices = Array.from({ length: N_REFERRALS }, (_, i) => i);
  const filleuls = await enParallele(indices, CONCURRENCE, async (i) => {
    const n = String(i + 1).padStart(3, '0');
    const email = `filleul.${CODE.toLowerCase()}${n}@mbenguiste.dev`;
    const id = await ensureAuthUser(email, 'Demo!2026');
    if (!id) return null;
    const r = rng(i);
    const femme = r() < 0.55;
    return {
      id,
      email,
      first_name: `${PRENOMS[i % PRENOMS.length]}`,
      birth_date: `${1988 + Math.floor(r() * 14)}-0${1 + Math.floor(r() * 9)}-1${Math.floor(r() * 9)}`,
      gender_id: genres.get(femme ? 'woman' : 'man') ?? null,
      onboarding_done: true,
      // Inscription étalée sur les 120 derniers jours (le graphe a du relief).
      created_at: new Date(Date.now() - Math.floor(r() * 120) * JOUR).toISOString(),
    };
  });

  const valides = filleuls.filter(Boolean);
  logger.info(`  ${valides.length}/${N_REFERRALS} comptes prêts`);

  // Profils par paquets (l'upsert accepte des tableaux).
  for (let i = 0; i < valides.length; i += 50) {
    const { error } = await supabase.from('profiles').upsert(valides.slice(i, i + 50), { onConflict: 'id' });
    if (error) throw error;
  }
  logger.info('  profils enregistrés');

  // ── 3. Les attributions (referrals) ────────────────────────────────────────
  const attributions = valides.map((f) => ({
    profile_id: f.id,
    code: CODE,
    partner_id: partenaire.id,
    source: 'link',
    attributed_at: f.created_at,
  }));
  for (let i = 0; i < attributions.length; i += 100) {
    const { error } = await supabase.from('referrals')
      .upsert(attributions.slice(i, i + 100), { onConflict: 'profile_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  logger.info(`  ${attributions.length} attributions au code ${CODE}`);

  // ── 4. Abonnements + commissions ───────────────────────────────────────────
  const abonnes = valides.slice(0, Math.min(N_SUBSCRIBERS, valides.length));
  logger.info(`Abonnements pour ${abonnes.length} filleuls + commissions…`);

  const lignes = [];
  const majProfils = [];

  abonnes.forEach((f, i) => {
    const r = rng(1000 + i);
    const plan = PLANS[Math.floor(r() * PLANS.length)];
    // 1 à 4 échéances mensuelles, la plus ancienne d'abord. Le DERNIER paiement
    // tombe il y a 0-25 jours : sans ça, aucune commission ne serait encore dans
    // la période de sécurité et le solde « en attente » resterait à zéro.
    const echeances = 1 + Math.floor(r() * 4);
    const premierIlYa = 30 * (echeances - 1) + Math.floor(r() * 26);

    // Encore abonné aujourd'hui pour ~80 % d'entre eux.
    const actif = r() < 0.8;
    majProfils.push({
      id: f.id,
      email: f.email,
      first_name: f.first_name,
      birth_date: f.birth_date,
      is_premium: actif,
      premium_tier: actif ? plan.tier : null,
      premium_until: actif ? new Date(Date.now() + 20 * JOUR).toISOString() : null,
    });

    for (let k = 0; k < echeances; k += 1) {
      const ilYa = premierIlYa - k * 30;
      const quand = Date.now() - ilYa * JOUR;
      const spec = computeCommission({
        event: {
          type: k === 0 ? 'INITIAL_PURCHASE' : 'RENEWAL',
          price: plan.price,
          currency: 'EUR',
          takehome_percentage: 0.7,
          purchased_at_ms: quand,
        },
        rateBps: RATE_BPS,
        firstPaymentAt: null,
        now: new Date(),
      });
      if (!spec) continue;

      // > 60 j → déjà versé ; 30-60 j → validé (hold écoulé) ; < 30 j → en attente.
      const statut = ilYa > 60 ? 'paid' : 'pending';
      lignes.push({
        partner_id: partenaire.id,
        profile_id: f.id,
        event_id: `seed-${f.id}-${k}`,
        event_type: spec.eventType,
        gross_cents: spec.grossCents,
        net_cents: spec.netCents,
        rate_bps: spec.rateBps,
        commission_cents: spec.commissionCents,
        currency: spec.currency,
        status: statut,
        hold_until: spec.holdUntil.toISOString(),
        occurred_at: spec.occurredAt.toISOString(),
      });
    }
  });

  for (let i = 0; i < majProfils.length; i += 50) {
    const { error } = await supabase.from('profiles').upsert(majProfils.slice(i, i + 50), { onConflict: 'id' });
    if (error) throw error;
  }

  for (let i = 0; i < lignes.length; i += 100) {
    const { error } = await supabase.from('commission_ledger')
      .upsert(lignes.slice(i, i + 100), { onConflict: 'event_id', ignoreDuplicates: true });
    if (error) throw error;
  }
  logger.info(`  ${lignes.length} commissions inscrites`);

  // ── 5. Un versement passé, pour que l'historique ne soit pas vide ──────────
  const deja = lignes.filter((l) => l.status === 'paid');
  const totalVerse = deja.reduce((s, l) => s + l.commission_cents, 0);
  if (totalVerse > 0) {
    const { data: versement, error: vErr } = await supabase
      .from('partner_payouts')
      .insert({
        partner_id: partenaire.id,
        amount_cents: totalVerse,
        currency: 'EUR',
        method: 'Orange Money',
        reference: 'SEED-DEMO-01',
        paid_at: new Date(Date.now() - 20 * JOUR).toISOString(),
      })
      .select('id')
      .single();
    if (vErr) throw vErr;
    await supabase.from('commission_ledger')
      .update({ payout_id: versement.id })
      .eq('partner_id', partenaire.id)
      .eq('status', 'paid');
    logger.info(`  versement historique de ${(totalVerse / 100).toFixed(2)} € enregistré`);
  }

  // ── Récapitulatif ──────────────────────────────────────────────────────────
  const somme = (f) => lignes.filter(f).reduce((s, l) => s + l.commission_cents, 0);
  const maintenant = Date.now();
  const enAttente = somme((l) => l.status === 'pending' && new Date(l.hold_until).getTime() > maintenant);
  const valide = somme((l) => l.status === 'pending' && new Date(l.hold_until).getTime() <= maintenant);

  logger.info('');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  Partenaire : ${NAME}  (Fondateur, ${(RATE_BPS / 100).toFixed(0)} %)`);
  logger.info(`  Code       : ${CODE}`);
  logger.info(`  Filleuls   : ${valides.length}   dont abonnés : ${abonnes.length}`);
  logger.info(`  En attente : ${(enAttente / 100).toFixed(2)} €`);
  logger.info(`  Validé     : ${(valide / 100).toFixed(2)} €`);
  logger.info(`  Versé      : ${(totalVerse / 100).toFixed(2)} €`);
  logger.info('  ─────────────────────────────────────────────────');
  logger.info('  CONNEXION AU PORTAIL  →  /partenaires');
  logger.info(`    email        : ${EMAIL}`);
  logger.info(`    mot de passe : ${PASSWORD}`);
  logger.info('  (compte confirmé d\'office : aucun email envoyé)');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`Terminé en ${Math.round((Date.now() - t0) / 1000)} s.`);
}

main().catch((e) => {
  logger.error(e.message || e);
  process.exit(1);
});
