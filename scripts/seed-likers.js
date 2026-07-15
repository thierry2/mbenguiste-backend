/**
 * Seed de TEST « qui t'a liké » — remplit les onglets Likes + Coups de cœur.
 *
 *   node scripts/seed-likers.js
 *
 * Crée 50 profils fictifs (Supabase Auth + profil complet + photo floutée) qui
 * LIKENT une cible : un mélange de super-likes (coups de cœur, révélés pour tous)
 * et de likes ordinaires (révélés en premium, floutés en gratuit). Tous « en
 * attente » (la cible ne les a pas swipés) → ils apparaissent dans /likes.
 *
 * Cible : env TARGET_LIKE_EMAIL, sinon thierryfokongg@gmail.com.
 * Volume : env LIKERS_COUNT (défaut 50), SUPERLIKE_RATIO (défaut 0.35).
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans l'env, et le schéma
 * appliqué. Idempotent : emails déterministes tester01..NN, relançable.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const logger = require('../src/utils/logger');
const { makeMaskedUrl } = require('../src/services/mask.service');

const TARGET_EMAIL = process.env.TARGET_LIKE_EMAIL || 'thierryfokongg@gmail.com';
const COUNT = Math.max(1, parseInt(process.env.LIKERS_COUNT || '50', 10));
const SUPERLIKE_RATIO = parseFloat(process.env.SUPERLIKE_RATIO || '0.35');
const PASSWORD = 'Demo!2026';

const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fit=crop`;

// Prénoms féminins (la cible par défaut cherche des femmes ; adapte si besoin).
const NAMES = [
  'Aminata', 'Nadia', 'Léa', 'Fatoumata', 'Aïssatou', 'Mariam', 'Chloé', 'Awa', 'Grâce', 'Salimata',
  'Inès', 'Rokia', 'Fanta', 'Camille', 'Sarah', 'Emma', 'Bintou', 'Kadiatou', 'Nafissatou', 'Maya',
  'Adjoa', 'Yasmine', 'Clarisse', 'Oumou', 'Manon', 'Djeneba', 'Farida', 'Sira', 'Coumba', 'Lucie',
  'Ramata', 'Hawa', 'Assa', 'Naïma', 'Estelle', 'Mbackda', 'Ndeye', 'Aurélie', 'Safiatou', 'Julie',
  'Kani', 'Marlène', 'Aya', 'Zeinab', 'Prisca', 'Fabiola', 'Wendy', 'Mariama', 'Céline', 'Fanta',
];

// Villes avec coords réelles (beaucoup près de la France → distance crédible).
const CITIES = [
  ['FR', 'Saint-Étienne', 45.4397, 4.3872], ['FR', 'Lyon', 45.7640, 4.8357],
  ['FR', 'Paris', 48.8566, 2.3522], ['FR', 'Marseille', 43.2965, 5.3698],
  ['FR', 'Villeurbanne', 45.7719, 4.8902], ['FR', 'Grenoble', 45.1885, 5.7245],
  ['FR', 'Clermont-Ferrand', 45.7772, 3.0870], ['FR', 'Valence', 44.9334, 4.8924],
  ['BE', 'Bruxelles', 50.8503, 4.3517], ['CH', 'Genève', 46.2044, 6.1432],
  ['CI', 'Abidjan', 5.3599, -4.0083], ['SN', 'Dakar', 14.7167, -17.4677],
  ['CM', 'Douala', 4.0511, 9.7679], ['CA', 'Montréal', 45.5017, -73.5673],
  ['MA', 'Casablanca', 33.5731, -7.5898], ['ML', 'Bamako', 12.6392, -8.0029],
];

const ORIGINS = ['CI', 'SN', 'CM', 'ML', 'CD', 'GH', 'MA', 'BF', 'TG', 'BJ'];
const OCCUPATIONS = ['Infirmière', 'Architecte', 'Étudiante', 'Comptable', 'Avocate', 'Designer', 'Enseignante', 'Sage-femme', 'Journaliste', 'Pharmacienne'];

const BIOS = [
  'Le rire facile et le thé qui refroidit parce qu\'on parle trop.',
  'Amoureuse des voyages et des longues discussions le soir.',
  'Je cuisine comme ma grand-mère et je danse mal, mais avec le cœur.',
  'Dimanche parfait : brunch, playlist afrobeats, zéro réveil.',
  'Sérieuse au travail, complètement bavarde le reste du temps.',
  'Fan de rando, de cinéma et de bons petits plats maison.',
  'On se reconnaît à la première blague, non ?',
  'La famille d\'abord, mais toujours partante pour l\'aventure.',
];

// Réponses de prompt = l'accroche affichée sur la carte vedette.
const ACCROCHES = [
  'La rando au lever du soleil, non négociable.',
  'Fais-moi rire et tu as déjà gagné des points.',
  'Je cherche quelqu\'un qui appelle plutôt qu\'il texte.',
  'Mon péché mignon : le thieb du dimanche en famille.',
  'Je voyage léger mais j\'aime fort.',
  'Un bon plat, une bonne playlist, et on refait le monde.',
  'La douceur et le sens de la famille, ça me touche.',
  'Spontanée : propose, je dis souvent oui.',
];

// Pool de portraits Unsplash (réutilisés si besoin, sans souci).
const PHOTOS = [
  '1531123897727-8f129e1688ce', '1611432579699-484f7990b127', '1531727991582-cfd25ce79613',
  '1589156280159-27698a70f29e', '1567532939604-b6b5b0db2604', '1494790108377-be9c29b29330',
  '1618085222100-93f0eecad0aa', '1544005313-94ddf0286df2', '1508214751196-bcfd4ca60f91',
  '1534528741775-53994a69daeb', '1517841905240-472988babdf9', '1524504388940-b1c1722653e1',
  '1502823403499-6ccfcf4fb453', '1487412720507-e7ab37603c6f', '1499887142886-791eca5918cd',
  '1489424731084-a5d8b219a5bb', '1522075469751-3a6694fb2f61', '1529626455594-4ff0802cfb7e',
  '1541101767792-f9b2b1c4f127', '1546961329-78bef0414d7c', '1502767089025-6572583495c8',
  '1552058544-f2b08422138a', '1463453091185-61582044d556', '1500648767791-00dcc994a43e',
];

const pick = (arr, i) => arr[i % arr.length];
const ONLINE_MS = 15 * 60 * 1000;

async function refMap(table) {
  const { data, error } = await supabase.from(table).select('id, code');
  if (error) throw error;
  return new Map((data || []).map((r) => [r.code, r]));
}

/** Trouve (ou attend) l'id auth pour un email déterministe, création idempotente. */
async function ensureAuthUser(email) {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (!error) return created.user.id;
  // Déjà créé lors d'un run précédent → on relit l'id via le profil existant.
  const { data: prof } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
  if (prof?.id) return prof.id;
  // Filet : parcours paginé des comptes Auth.
  for (let page = 1; page <= 40; page++) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const u = list?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!list?.users?.length || list.users.length < 200) break;
  }
  return null;
}

async function main() {
  logger.info(`Cible du seed : ${TARGET_EMAIL}`);
  const { data: target, error: tErr } = await supabase
    .from('profiles').select('id, first_name').eq('email', TARGET_EMAIL).maybeSingle();
  if (tErr) throw tErr;
  if (!target) { logger.error(`Aucun profil pour ${TARGET_EMAIL}. Connecte-toi une fois à l'app d'abord.`); process.exit(1); }
  logger.info(`✓ Cible trouvée : ${target.first_name} (${target.id})`);

  const genders = await refMap('genders');
  const goals = await refMap('relationship_goals');
  const swipeActions = await refMap('swipe_actions');
  const womanId = genders.get('woman')?.id ?? null;
  const manId = genders.get('man')?.id ?? null;
  const likeId = swipeActions.get('like')?.id;
  const superLikeId = swipeActions.get('super_like')?.id;
  if (!likeId || !superLikeId) throw new Error('Actions like/super_like introuvables dans swipe_actions.');

  let nCoeurs = 0, nLikes = 0, nFail = 0;

  for (let i = 0; i < COUNT; i++) {
    const n = String(i + 1).padStart(2, '0');
    const email = `tester${n}@mbenguiste.dev`;
    const prenom = pick(NAMES, i);
    const [pays, ville, lat, lng] = pick(CITIES, i);
    const isSuper = Math.random() < SUPERLIKE_RATIO;
    const online = Math.random() < 0.3;

    const userId = await ensureAuthUser(email);
    if (!userId) { logger.warn(`${email} : compte Auth introuvable`); nFail++; continue; }

    const photoId = pick(PHOTOS, i);
    const avatar = U(photoId, 400);

    const { error: profErr } = await supabase.from('profiles').upsert({
      id: userId,
      email,
      first_name: prenom,
      birth_date: `${1990 + (i % 12)}-0${1 + (i % 9)}-15`,
      gender_id: womanId,
      bio: pick(BIOS, i),
      avatar_url: avatar,
      current_country: pays, current_city: ville,
      current_lat: lat, current_lng: lng,
      origin_country: pick(ORIGINS, i),
      occupation: pick(OCCUPATIONS, i),
      height_cm: 160 + (i % 20),
      target_country: 'FR', target_city: 'Paris',
      open_to_relocate: true,
      relationship_goal_id: goals.get('serious')?.id ?? null,
      primary_language: 'fr', spoken_languages: ['fr'],
      is_verified: Math.random() > 0.4,
      onboarding_done: true,
      is_discoverable: true,
      last_active_at: online ? new Date().toISOString() : new Date(Date.now() - 2 * 86400e3).toISOString(),
    }, { onConflict: 'id' });
    if (profErr) { logger.warn(`${prenom} : profil KO (${profErr.message})`); nFail++; continue; }

    // Photo principale + version floutée (pour les cartes masquées en gratuit).
    await supabase.from('profile_photos').delete().eq('profile_id', userId);
    let blur = null;
    try { blur = await makeMaskedUrl(U(photoId)); } catch { /* fallback silhouette */ }
    await supabase.from('profile_photos').insert({ profile_id: userId, url: U(photoId), blur_url: blur, position: 0 });

    // Préférences (cherche des hommes) + un prompt = l'accroche de la carte.
    await supabase.from('match_preferences').upsert({
      profile_id: userId, seeking_gender_id: manId, min_age: 22, max_age: 50,
    }, { onConflict: 'profile_id' });

    // Le LIKE / SUPER-LIKE vers la cible (en attente → apparaît dans /likes).
    const { error: swErr } = await supabase.from('swipes').upsert({
      swiper_id: userId, target_id: target.id, action_id: isSuper ? superLikeId : likeId,
    }, { onConflict: 'swiper_id,target_id' });
    if (swErr) { logger.warn(`${prenom} : swipe KO (${swErr.message})`); nFail++; continue; }

    if (isSuper) nCoeurs++; else nLikes++;
    logger.info(`✓ ${prenom.padEnd(12)} ${ville.padEnd(16)} ${isSuper ? '💖 coup de cœur' : '❤️ like'}${online ? ' · en ligne' : ''}`);
  }

  logger.info('──────────────────────────────────────────');
  logger.info(`Terminé : ${nCoeurs} coups de cœur + ${nLikes} likes vers ${target.first_name}${nFail ? ` (${nFail} échecs)` : ''}.`);
  logger.info(`Comptes testeurs : tester01..${String(COUNT).padStart(2, '0')}@mbenguiste.dev / ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => { logger.error(e.stack || e.message); process.exit(1); });
