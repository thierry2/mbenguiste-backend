/**
 * Données de test Mbenguiste.
 *
 *   node scripts/seed.js
 *
 * Crée des comptes fictifs (Supabase Auth) + profils complets avec des ROUTES
 * variées — dans les deux sens, pour illustrer que l'app est neutre en origine
 * (une Ivoirienne cherche à Paris, un Français cherche à Dakar…).
 *
 * Nécessite SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY dans .env, et le schéma
 * `db/schema.sql` déjà appliqué. Idempotent : relançable sans doublon.
 */
require('dotenv').config();
const supabase = require('../src/config/supabase');
const logger = require('../src/utils/logger');
const { makeMaskedUrl } = require('../src/services/mask.service');

// Portraits Unsplash haute résolution (URLs stables, vérifiées une à une).
// randomuser.me ne sert que du 128 px : flou garanti sur une carte plein écran.
const U = (id, w = 900) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&fit=crop`;

const PROFILES = [
  { prenom: 'Aïcha',    genre: 'woman', seek: 'man',   an: 1997, from: ['CI','Abidjan'],  to: ['FR','Paris'],     goal: 'serious',    bio: "Pédiatre passionnée d'afrobeats et de longs appels le soir.", interests: ['afrobeats','cooking','travel'], photos: ['1531123897727-8f129e1688ce'] },
  { prenom: 'Marième',  genre: 'woman', seek: 'man',   an: 1994, from: ['SN','Dakar'],    to: ['BE','Bruxelles'], goal: 'marriage',   bio: "Le thieboudienne en famille puis un appel qui n'en finit pas.",   interests: ['faith','family','dance'],       photos: ['1611432579699-484f7990b127'] },
  { prenom: 'Fatou',    genre: 'woman', seek: 'man',   an: 1999, from: ['ML','Bamako'],   to: ['CA','Montréal'],  goal: 'serious',    bio: 'Étudiante en droit, je ris fort et je voyage léger.',            interests: ['reading','travel','cinema'],    photos: ['1531727991582-cfd25ce79613'] },
  { prenom: 'Grâce',    genre: 'woman', seek: 'man',   an: 1996, from: ['CD','Kinshasa'], to: ['FR','Lyon'],      goal: 'serious',    bio: 'Danseuse le week-end, comptable la semaine.',                    interests: ['dance','afrobeats','sport'],    photos: ['1589156280159-27698a70f29e'] },
  { prenom: 'Julien',   genre: 'man',   seek: 'woman', an: 1990, from: ['FR','Paris'],    to: ['SN','Dakar'],     goal: 'serious',    bio: "Prof de français rêvant de soleil et de teranga. Oui, un Parisien qui veut partir.", interests: ['reading','travel','cooking'], photos: ['1500648767791-00dcc994a43e'] },
  { prenom: 'Kwame',    genre: 'man',   seek: 'woman', an: 1992, from: ['GH','Accra'],    to: ['GB','Londres'],   goal: 'serious',    bio: 'Ingénieur, fan de jollof (le meilleur, ne débattons pas).',      interests: ['entrepreneurship','sport','travel'], photos: ['1531384441138-2736e62e0919', '1522529599102-193c0d76b5b6'] },
  { prenom: 'Thomas',   genre: 'man',   seek: 'woman', an: 1988, from: ['BE','Bruxelles'],to: ['CI','Abidjan'],   goal: 'marriage',   bio: 'Belge, restaurateur, amoureux de la cuisine ouest-africaine.',   interests: ['cooking','faith','family'],     photos: ['1506794778202-cad84cf45f1d'] },
  { prenom: 'Ibrahim',  genre: 'man',   seek: 'woman', an: 1995, from: ['CM','Douala'],   to: ['DE','Berlin'],    goal: 'serious',    bio: 'Développeur le jour, guitariste le soir.',                        interests: ['afrobeats','entrepreneurship','cinema'], photos: ['1543610892-0b1f7e6d8ac1'] },
  { prenom: 'Sarah',    genre: 'woman', seek: 'man',   an: 1993, from: ['MA','Casablanca'],to: ['CA','Toronto'],   goal: 'serious',    bio: 'Architecte, thé à la menthe non négociable.',                    interests: ['travel','reading','cinema'],    photos: ['1567532939604-b6b5b0db2604'] },
  { prenom: 'Chloé',    genre: 'woman', seek: 'man',   an: 1998, from: ['CH','Genève'],   to: ['CM','Yaoundé'],   goal: 'serious',    bio: 'Suissesse humanitaire, le cœur déjà en Afrique centrale.',        interests: ['faith','travel','family'],      photos: ['1494790108377-be9c29b29330'] },
  { prenom: 'David',    genre: 'man',   seek: 'woman', an: 1991, from: ['CA','Montréal'], to: ['CD','Kinshasa'],  goal: 'serious',    bio: 'Musicien québécois, la rumba dans la peau.',                     interests: ['dance','afrobeats','travel'],   photos: ['1595152772835-219674b2a8a6', '1507003211169-0a1dd7228f2d'] },
  { prenom: 'Awa',      genre: 'woman', seek: 'man',   an: 2000, from: ['CI','Bouaké'],   to: ['US','New York'],  goal: 'unsure',     bio: "Créatrice de mode, je verrai bien où le cœur me mène.",          interests: ['entrepreneurship','dance','cinema'], photos: ['1618085222100-93f0eecad0aa'] },
];

const PROMPTS = {
  perfect_sunday: 'Un brunch tranquille, de la musique, et pas de réveil.',
  move_for_love: "quelqu'un qui me fait rire aux éclats.",
  green_flag: 'la douceur et le sens de la famille.',
};

async function refMap(table, extra = '') {
  const { data, error } = await supabase.from(table).select(`id, code${extra}`);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.code, r]));
}

async function main() {
  logger.info('Chargement des tables de référence…');
  const genders = await refMap('genders');
  const goals = await refMap('relationship_goals');
  const interests = await refMap('interests');
  const promptsRef = await refMap('prompts');

  for (const p of PROFILES) {
    const email = `demo.${p.prenom.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@mbenguiste.dev`;

    // 1) Compte Auth (idempotent : on ignore si déjà présent).
    let userId;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email, password: 'Demo!2026', email_confirm: true,
    });
    if (createErr) {
      const { data: list } = await supabase.auth.admin.listUsers();
      userId = list?.users?.find((u) => u.email === email)?.id;
      if (!userId) { logger.warn(`${p.prenom} : impossible de créer/retrouver le compte (${createErr.message})`); continue; }
    } else {
      userId = created.user.id;
    }

    // 2) Profil.
    const { error: profErr } = await supabase.from('profiles').upsert({
      id: userId,
      email,
      first_name: p.prenom,
      birth_date: `${p.an}-06-15`,
      gender_id: genders.get(p.genre)?.id ?? null,
      bio: p.bio,
      avatar_url: U(p.photos[0], 400),
      current_country: p.from[0], current_city: p.from[1],
      target_country: p.to[0], target_city: p.to[1],
      open_to_relocate: true,
      relationship_goal_id: goals.get(p.goal)?.id ?? null,
      primary_language: 'fr', spoken_languages: ['fr'],
      is_verified: Math.random() > 0.4,
      onboarding_done: true,
    }, { onConflict: 'id' });
    if (profErr) { logger.warn(`${p.prenom} : profil KO (${profErr.message})`); continue; }

    // 3) Photos (haute résolution) + leur version floutée (contextes masqués),
    //    intérêts, prompts, préférences.
    await supabase.from('profile_photos').delete().eq('profile_id', userId);
    const photoRows = [];
    for (let i = 0; i < p.photos.length; i++) {
      const url = U(p.photos[i]);
      let blur_url = null;
      try {
        blur_url = await makeMaskedUrl(url);
      } catch (e) {
        logger.warn(`${p.prenom} : flou photo KO (${e.message})`);
      }
      photoRows.push({ profile_id: userId, url, blur_url, position: i });
    }
    await supabase.from('profile_photos').insert(photoRows);

    await supabase.from('profile_interests').delete().eq('profile_id', userId);
    const interestRows = p.interests.map((code) => ({ profile_id: userId, interest_id: interests.get(code)?.id })).filter((r) => r.interest_id);
    if (interestRows.length) await supabase.from('profile_interests').insert(interestRows);

    const promptRows = Object.entries(PROMPTS)
      .map(([code, answer], i) => ({ profile_id: userId, prompt_id: promptsRef.get(code)?.id, answer, position: i }))
      .filter((r) => r.prompt_id);
    await supabase.from('profile_prompts').delete().eq('profile_id', userId);
    if (promptRows.length) await supabase.from('profile_prompts').insert(promptRows);

    await supabase.from('match_preferences').upsert({
      profile_id: userId,
      seeking_gender_id: genders.get(p.seek)?.id ?? null,
      min_age: 22, max_age: 45,
    }, { onConflict: 'profile_id' });

    logger.info(`✓ ${p.prenom}  ${p.from[1]} → ${p.to[1]}`);
  }

  logger.info('Seed terminé. Mot de passe des comptes démo : Demo!2026');
  process.exit(0);
}

main().catch((e) => { logger.error(e.stack || e.message); process.exit(1); });
