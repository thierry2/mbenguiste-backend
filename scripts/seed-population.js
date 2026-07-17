/**
 * Seed de POPULATION — remplit la base de profils de test pour le deck.
 *
 *   node scripts/seed-population.js
 *
 * Crée 100 femmes + 100 hommes (Supabase Auth + profil complet) : photos avec
 * version floutée, intérêts, prompts, lifestyle, préférences. Aucun swipe :
 * ce seed peuple uniquement la découverte (contrairement à seed-likers.js qui
 * fabrique des likes vers une cible).
 *
 * Volume : env SEED_WOMEN (défaut 100), SEED_MEN (défaut 100).
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env, et le schéma
 * appliqué. Idempotent : emails déterministes seedw001../seedm001.., relançable.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const logger = require('../src/utils/logger');
const { makeMaskedUrl } = require('../src/services/mask.service');

const N_WOMEN = Math.max(0, parseInt(process.env.SEED_WOMEN || '100', 10));
const N_MEN = Math.max(0, parseInt(process.env.SEED_MEN || '100', 10));
const PASSWORD = 'Demo!2026';

const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fit=crop`;

// PRNG déterministe par index → relançable sans que les profils « bougent ».
const rng = (seed) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const NAMES_W = [
  'Aminata', 'Nadia', 'Léa', 'Fatoumata', 'Aïssatou', 'Mariam', 'Chloé', 'Awa', 'Grâce', 'Salimata',
  'Inès', 'Rokia', 'Fanta', 'Camille', 'Sarah', 'Emma', 'Bintou', 'Kadiatou', 'Nafissatou', 'Maya',
  'Adjoa', 'Yasmine', 'Clarisse', 'Oumou', 'Manon', 'Djeneba', 'Farida', 'Sira', 'Coumba', 'Lucie',
  'Ramata', 'Hawa', 'Assa', 'Naïma', 'Estelle', 'Aïcha', 'Ndeye', 'Aurélie', 'Safiatou', 'Julie',
  'Kani', 'Marlène', 'Aya', 'Zeinab', 'Prisca', 'Fabiola', 'Wendy', 'Mariama', 'Céline', 'Marième',
];

const NAMES_M = [
  'Ibrahim', 'Kwame', 'Moussa', 'Julien', 'Thomas', 'Abdoulaye', 'David', 'Sékou', 'Yannick', 'Cheikh',
  'Mamadou', 'Kevin', 'Ousmane', 'Franck', 'Aziz', 'Didier', 'Lamine', 'Serge', 'Boubacar', 'Hervé',
  'Souleymane', 'Marc', 'Idriss', 'Patrick', 'Tidiane', 'Rodrigue', 'Bakary', 'Steve', 'Amadou', 'Cédric',
  'Youssouf', 'Landry', 'Modibo', 'Jordan', 'Issa', 'Wilfried', 'Demba', 'Éric', 'Karim', 'Axel',
  'Drissa', 'Loïc', 'Fodé', 'Brice', 'Salif', 'Armand', 'Tiémoko', 'Ryan', 'Adama', 'Christian',
];

// Villes avec coords réelles (mélange Europe / Afrique / Amérique du Nord).
const CITIES = [
  ['FR', 'Paris', 48.8566, 2.3522], ['FR', 'Lyon', 45.7640, 4.8357],
  ['FR', 'Marseille', 43.2965, 5.3698], ['FR', 'Saint-Étienne', 45.4397, 4.3872],
  ['FR', 'Toulouse', 43.6047, 1.4442], ['FR', 'Lille', 50.6292, 3.0573],
  ['FR', 'Bordeaux', 44.8378, -0.5792], ['FR', 'Grenoble', 45.1885, 5.7245],
  ['BE', 'Bruxelles', 50.8503, 4.3517], ['CH', 'Genève', 46.2044, 6.1432],
  ['DE', 'Berlin', 52.5200, 13.4050], ['GB', 'Londres', 51.5074, -0.1278],
  ['CI', 'Abidjan', 5.3599, -4.0083], ['SN', 'Dakar', 14.7167, -17.4677],
  ['CM', 'Douala', 4.0511, 9.7679], ['CM', 'Yaoundé', 3.8480, 11.5021],
  ['ML', 'Bamako', 12.6392, -8.0029], ['CD', 'Kinshasa', -4.4419, 15.2663],
  ['GH', 'Accra', 5.6037, -0.1870], ['MA', 'Casablanca', 33.5731, -7.5898],
  ['CA', 'Montréal', 45.5017, -73.5673], ['US', 'New York', 40.7128, -74.0060],
];

const ORIGINS = ['CI', 'SN', 'CM', 'ML', 'CD', 'GH', 'MA', 'BF', 'TG', 'BJ', 'GN', 'GA', 'NE', 'CG'];

const OCCUPATIONS_W = ['Infirmière', 'Architecte', 'Étudiante', 'Comptable', 'Avocate', 'Designer', 'Enseignante', 'Sage-femme', 'Journaliste', 'Pharmacienne', 'Entrepreneuse', 'Développeuse', 'Commerciale', 'Coiffeuse', 'Kinésithérapeute'];
const OCCUPATIONS_M = ['Ingénieur', 'Infirmier', 'Comptable', 'Entrepreneur', 'Développeur', 'Enseignant', 'Commercial', 'Kinésithérapeute', 'Chauffeur VTC', 'Architecte', 'Électricien', 'Médecin', 'Journaliste', 'Logisticien', 'Cuisinier'];

const BIOS_W = [
  "Le rire facile et le thé qui refroidit parce qu'on parle trop.",
  'Amoureuse des voyages et des longues discussions le soir.',
  'Je cuisine comme ma grand-mère et je danse mal, mais avec le cœur.',
  'Dimanche parfait : brunch, playlist afrobeats, zéro réveil.',
  'Sérieuse au travail, complètement bavarde le reste du temps.',
  'Fan de rando, de cinéma et de bons petits plats maison.',
  'On se reconnaît à la première blague, non ?',
  "La famille d'abord, mais toujours partante pour l'aventure.",
  'Team appels de 3 heures plutôt que textos secs.',
  'Je collectionne les couchers de soleil et les recettes de famille.',
];

const BIOS_M = [
  'Le genre à préparer le café avant que tu te réveilles.',
  'Fan de foot le week-end, cuisinier appliqué le soir.',
  'Je ris de mes propres blagues, il paraît que c\'est contagieux.',
  'Grand voyageur, mais je cherche un point d\'ancrage.',
  'Sérieux dans le travail, joueur dans la vie.',
  'La musique d\'abord : afrobeats, rumba, un peu de jazz.',
  'Je préfère un appel à mille textos.',
  'Famille, foi, et un bon plat partagé : ma définition du bonheur.',
  'Sportif du dimanche, motivé du lundi.',
  'On commence par un café et on voit où ça nous mène ?',
];

// Réponses de prompt (l'accroche affichée sur la carte).
const ACCROCHES = [
  'La rando au lever du soleil, non négociable.',
  'Fais-moi rire et tu as déjà gagné des points.',
  "Quelqu'un qui appelle plutôt qu'il texte.",
  'Mon péché mignon : le thieb du dimanche en famille.',
  "Je voyage léger mais j'aime fort.",
  'Un bon plat, une bonne playlist, et on refait le monde.',
  'La douceur et le sens de la famille, ça me touche.',
  'Spontané·e : propose, je dis souvent oui.',
  'Un marché local, des rires, et une glace pour finir.',
  'La sincérité dès le premier message.',
];

// Portraits Unsplash stables (pool réutilisé en boucle, déjà éprouvé dans les
// autres seeds).
const PHOTOS_W = [
  '1531123897727-8f129e1688ce', '1611432579699-484f7990b127', '1531727991582-cfd25ce79613',
  '1589156280159-27698a70f29e', '1567532939604-b6b5b0db2604', '1494790108377-be9c29b29330',
  '1618085222100-93f0eecad0aa', '1544005313-94ddf0286df2', '1508214751196-bcfd4ca60f91',
  '1534528741775-53994a69daeb', '1517841905240-472988babdf9', '1524504388940-b1c1722653e1',
  '1502823403499-6ccfcf4fb453', '1487412720507-e7ab37603c6f', '1499887142886-791eca5918cd',
  '1489424731084-a5d8b219a5bb', '1522075469751-3a6694fb2f61', '1529626455594-4ff0802cfb7e',
  '1541101767792-f9b2b1c4f127', '1546961329-78bef0414d7c', '1502767089025-6572583495c8',
  '1552058544-f2b08422138a', '1463453091185-61582044d556',
];

const PHOTOS_M = [
  '1500648767791-00dcc994a43e', '1506794778202-cad84cf45f1d', '1531384441138-2736e62e0919',
  '1522529599102-193c0d76b5b6', '1543610892-0b1f7e6d8ac1', '1595152772835-219674b2a8a6',
  '1507003211169-0a1dd7228f2d', '1519085360753-af0119f7cbe7', '1472099645785-5658abf4ff4e',
  '1560250097-0b93528c311a', '1492562080023-ab3db95bfbce', '1568602471122-7832951cc4c5',
  '1564564321837-a57b7070ac4f', '1519345182560-3f2917c472ef', '1506277886164-e25aa3f4ef7f',
  '1544723795-3fb6469f5b39', '1547425260-76bcadfb4f2c', '1557862921-37829c790f19',
];

const GOALS = ['serious', 'serious', 'serious', 'marriage', 'unsure']; // pondéré vers « sérieux »

const pick = (arr, i) => arr[i % arr.length];
const pickR = (arr, r) => arr[Math.floor(r() * arr.length)];

async function refMap(table) {
  const { data, error } = await supabase.from(table).select('id, code');
  if (error) throw error;
  return new Map((data || []).map((r) => [r.code, r]));
}

/** Options lifestyle groupées par kind : { smoking: ['no','social',…], … } */
async function lifestyleByKind() {
  const { data, error } = await supabase.from('lifestyle_options').select('kind, code');
  if (error) throw error;
  const out = {};
  for (const r of data || []) (out[r.kind] ||= []).push(r.code);
  return out;
}

/** Trouve (ou attend) l'id auth pour un email déterministe, création idempotente. */
async function ensureAuthUser(email) {
  const { data: created, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (!error) return created.user.id;
  const { data: prof } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
  if (prof?.id) return prof.id;
  for (let page = 1; page <= 40; page++) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const u = list?.users?.find((x) => x.email === email);
    if (u) return u.id;
    if (!list?.users?.length || list.users.length < 200) break;
  }
  return null;
}

async function seedOne({ i, seedOffset, genre, refs }) {
  const { genders, goals, interests, promptsRef, lifestyle } = refs;
  const r = rng(seedOffset + i);
  const isWoman = genre === 'woman';
  const n = String(i + 1).padStart(3, '0');
  const email = `${isWoman ? 'seedw' : 'seedm'}${n}@mbenguiste.dev`;
  const prenom = pick(isWoman ? NAMES_W : NAMES_M, i);
  const [pays, ville, lat, lng] = pickR(CITIES, r);
  const photos = isWoman ? PHOTOS_W : PHOTOS_M;
  const online = r() < 0.25;

  const userId = await ensureAuthUser(email);
  if (!userId) { logger.warn(`${email} : compte Auth introuvable`); return null; }

  const mainPhoto = pick(photos, i);
  const secondPhoto = pick(photos, i + 7);
  const birthYear = 1985 + Math.floor(r() * 18);            // 23–41 ans en 2026
  const heightCm = isWoman ? 155 + Math.floor(r() * 24) : 168 + Math.floor(r() * 28);

  // Lifestyle : un sous-ensemble de kinds, valeur tirée dans les vraies options.
  const life = {};
  for (const kind of ['smoking', 'drinking', 'religion', 'living', 'family', 'sport']) {
    if (lifestyle[kind]?.length && r() < 0.8) life[kind] = pickR(lifestyle[kind], r);
  }

  const { error: profErr } = await supabase.from('profiles').upsert({
    id: userId,
    email,
    first_name: prenom,
    birth_date: `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
    gender_id: genders.get(genre)?.id ?? null,
    bio: pick(isWoman ? BIOS_W : BIOS_M, i),
    avatar_url: U(mainPhoto, 400),
    current_country: pays, current_city: ville,
    current_lat: lat, current_lng: lng,
    origin_country: pickR(ORIGINS, r),
    occupation: pick(isWoman ? OCCUPATIONS_W : OCCUPATIONS_M, i),
    height_cm: heightCm,
    relationship_goal_id: goals.get(pickR(GOALS, r))?.id ?? null,
    primary_language: 'fr', spoken_languages: ['fr'],
    lifestyle: life,
    is_verified: r() > 0.4,
    onboarding_done: true,
    is_discoverable: true,
    last_active_at: online
      ? new Date().toISOString()
      : new Date(Date.now() - Math.floor(r() * 6 + 1) * 86400e3).toISOString(),
  }, { onConflict: 'id' });
  if (profErr) { logger.warn(`${prenom} (${email}) : profil KO (${profErr.message})`); return null; }

  // Photos : 2 par profil, flou sur la principale (contextes masqués).
  await supabase.from('profile_photos').delete().eq('profile_id', userId);
  let blur = null;
  try { blur = await makeMaskedUrl(U(mainPhoto)); } catch { /* fallback silhouette */ }
  await supabase.from('profile_photos').insert([
    { profile_id: userId, url: U(mainPhoto), blur_url: blur, position: 0 },
    { profile_id: userId, url: U(secondPhoto), position: 1 },
  ]);

  // Intérêts : 4 tirés parmi les vrais codes en base.
  const interestCodes = [...interests.keys()];
  const chosen = new Set();
  while (chosen.size < Math.min(4, interestCodes.length)) chosen.add(pickR(interestCodes, r));
  await supabase.from('profile_interests').delete().eq('profile_id', userId);
  await supabase.from('profile_interests').insert(
    [...chosen].map((code) => ({ profile_id: userId, interest_id: interests.get(code).id })),
  );

  // Prompts : 2 réponses.
  const promptCodes = [...promptsRef.keys()];
  const promptRows = [pick(promptCodes, i), pick(promptCodes, i + 1)]
    .filter((c, idx, a) => a.indexOf(c) === idx)
    .map((code, pos) => ({
      profile_id: userId,
      prompt_id: promptsRef.get(code).id,
      answer: pick(ACCROCHES, i + pos * 3),
      position: pos,
    }));
  await supabase.from('profile_prompts').delete().eq('profile_id', userId);
  if (promptRows.length) await supabase.from('profile_prompts').insert(promptRows);

  // Préférences : hétéro par défaut, tranche d'âge autour du sien.
  const age = 2026 - birthYear;
  await supabase.from('match_preferences').upsert({
    profile_id: userId,
    seeking_gender_id: genders.get(isWoman ? 'man' : 'woman')?.id ?? null,
    min_age: Math.max(18, age - 8), max_age: age + 10,
  }, { onConflict: 'profile_id' });

  logger.info(`✓ ${(isWoman ? '♀' : '♂')} ${prenom.padEnd(12)} ${ville.padEnd(14)} ${age} ans${online ? ' · en ligne' : ''}`);
  return userId;
}

async function main() {
  logger.info(`Seed population : ${N_WOMEN} femmes + ${N_MEN} hommes…`);
  const refs = {
    genders: await refMap('genders'),
    goals: await refMap('relationship_goals'),
    interests: await refMap('interests'),
    promptsRef: await refMap('prompts'),
    lifestyle: await lifestyleByKind(),
  };

  let ok = 0, ko = 0;
  for (let i = 0; i < N_WOMEN; i++) {
    (await seedOne({ i, seedOffset: 1000, genre: 'woman', refs })) ? ok++ : ko++;
  }
  for (let i = 0; i < N_MEN; i++) {
    (await seedOne({ i, seedOffset: 5000, genre: 'man', refs })) ? ok++ : ko++;
  }

  logger.info('──────────────────────────────────────────');
  logger.info(`Terminé : ${ok} profils créés/mis à jour${ko ? `, ${ko} échecs` : ''}.`);
  logger.info(`Comptes : seedw001..${String(N_WOMEN).padStart(3, '0')} / seedm001..${String(N_MEN).padStart(3, '0')} @mbenguiste.dev — mot de passe ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => { logger.error(e.stack || e.message); process.exit(1); });
