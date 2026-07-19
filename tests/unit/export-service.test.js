'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Export des données personnelles (droit à la portabilité, RGPD).
//
// La doctrine est celle d'AfrikMoms : on ne livre QUE ce que la personne a
// fourni ou produit. Sur une app de rencontre l'enjeu est plus lourd que sur un
// réseau de mamans — un export trop généreux livre les mots d'un tiers, révèle
// qui a liké qui (contournement pur et simple du paywall « Qui t'a liké ») et
// peut exposer le récit d'une victime dans un signalement.
//
// Ces tests verrouillent donc surtout des ABSENCES : ce qui ne doit jamais
// sortir. C'est le genre de règle qui se perd silencieusement à la première
// refonte, d'où le test global sur l'identité des tiers.
// ─────────────────────────────────────────────────────────────────────────────
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SUPABASE = path.join(__dirname, '..', '..', 'src', 'config', 'supabase.js');
const SERVICE = path.join(__dirname, '..', '..', 'src', 'services', 'export.service.js');

const MOI = 'moi-1';
const AUTRE = 'autre-1';

/**
 * Faux client Supabase : il APPLIQUE réellement les filtres eq/in/or sur les
 * lignes fournies. Sans ça, un test « mes messages seulement » passerait même si
 * le service oubliait son filtre sender_id — le pire faux positif possible ici.
 */
function faireSupabase(tables, journal) {
  return {
    from(table) {
      const q = { table, filtres: [], single: false };
      const builder = {
        select(cols) { q.select = cols; return builder; },
        eq(col, val) { q.filtres.push({ type: 'eq', col, val }); return builder; },
        in(col, vals) { q.filtres.push({ type: 'in', col, vals }); return builder; },
        or(expr) { q.filtres.push({ type: 'or', expr }); return builder; },
        order(col) { q.order = col; return builder; },
        maybeSingle() { q.single = true; return builder; },
        then(resolve, reject) {
          journal.push(q);
          let rows = (tables[table] ?? []).slice();
          for (const f of q.filtres) {
            if (f.type === 'eq') rows = rows.filter((r) => r[f.col] === f.val);
            if (f.type === 'in') rows = rows.filter((r) => f.vals.includes(r[f.col]));
            if (f.type === 'or') {
              // 'user_low.eq.moi-1,user_high.eq.moi-1'
              const clauses = f.expr.split(',').map((c) => {
                const [col, , ...reste] = c.split('.');
                return { col, val: reste.join('.') };
              });
              rows = rows.filter((r) => clauses.some((c) => r[c.col] === c.val));
            }
          }
          const data = q.single ? (rows[0] ?? null) : rows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

/** Charge le service avec un faux Supabase, le temps d'un test. */
async function exporter(tables) {
  const journal = [];
  const cleSupabase = require.resolve(SUPABASE);
  const cleService = require.resolve(SERVICE);
  const avantSupabase = require.cache[cleSupabase];

  require.cache[cleSupabase] = {
    id: cleSupabase, filename: cleSupabase, loaded: true,
    exports: faireSupabase(tables, journal),
  };
  delete require.cache[cleService];   // pour qu'il capte notre faux client

  try {
    const { exportUserData } = require(SERVICE);
    return { data: await exportUserData(MOI), journal };
  } finally {
    if (avantSupabase) require.cache[cleSupabase] = avantSupabase;
    else delete require.cache[cleSupabase];
    delete require.cache[cleService];
  }
}

const BASE = {
  profiles: [{
    id: MOI, first_name: 'Awa', email: 'awa@ex.com', birth_date: '1995-04-02',
    bio: 'Ma bio', avatar_url: 'https://ex/a.jpg', current_city: 'Dakar',
    current_country: 'SN', origin_country: 'SN', occupation: 'Architecte',
    height_cm: 168, primary_language: 'fr', spoken_languages: ['fr', 'wo'],
    lifestyle: { astro: 'lion' }, is_verified: true, is_premium: false,
    created_at: '2026-01-01T00:00:00Z', push_token: 'SECRET-PUSH',
  }],
  profile_photos: [{ profile_id: MOI, url: 'https://ex/1.jpg', position: 0, created_at: '2026-01-02T00:00:00Z' }],
  profile_interests: [{ profile_id: MOI, interest: { code: 'cuisine', display_name: 'Cuisine' } }],
  profile_prompts: [{ profile_id: MOI, answer: 'Un thé et du silence', position: 0, prompt: { question: 'Un dimanche parfait ?' } }],
  match_preferences: [{ profile_id: MOI, min_age: 25, max_age: 40, regions: ['afrique_ouest'], verified_only: true }],
  matches: [{ id: 'match-1', user_low: MOI, user_high: AUTRE, created_at: '2026-02-01T00:00:00Z', is_active: true, ended_at: null }],
  messages: [
    { match_id: 'match-1', sender_id: MOI, body: 'Coucou', original_body: null, created_at: '2026-02-01T10:00:00Z' },
    { match_id: 'match-1', sender_id: AUTRE, body: 'SECRET DE TIERS', original_body: null, created_at: '2026-02-01T11:00:00Z' },
  ],
  swipes: [{ swiper_id: MOI, target_id: AUTRE, like_comment: 'Ton sourire', like_target_type: 'photo', created_at: '2026-01-30T00:00:00Z', action: { code: 'like', display_name: 'Like' } }],
  subscriptions: [{ profile_id: MOI, status: 'active', store: 'google', started_at: '2026-03-01T00:00:00Z', expires_at: '2026-04-01T00:00:00Z' }],
  consumable_purchases: [{ profile_id: MOI, quantity: 5, created_at: '2026-03-05T00:00:00Z', product: { kind: 'superlike' } }],
  user_credits: [{ profile_id: MOI, superlike_balance: 3, boost_balance: 1, joker_balance: 0, updated_at: '2026-03-06T00:00:00Z' }],
  usage_counters: [{ profile_id: MOI, kind: 'like', used: 12, window_start: '2026-03-06T00:00:00Z' }],
};

test('le profil, les photos, les prompts et les intérêts sortent en clés françaises', async () => {
  const { data } = await exporter(BASE);

  assert.equal(data.profil.prenom, 'Awa');
  assert.equal(data.profil.email, 'awa@ex.com');
  assert.equal(data.profil.metier, 'Architecte');
  assert.deepEqual(data.profil.langues, ['fr', 'wo']);
  assert.deepEqual(data.photos, [{ url: 'https://ex/1.jpg', position: 0, ajouteeLe: '2026-01-02T00:00:00Z' }]);
  assert.deepEqual(data.centresInteret, ['Cuisine']);
  assert.deepEqual(data.prompts, [{ question: 'Un dimanche parfait ?', reponse: 'Un thé et du silence' }]);
  assert.equal(data.preferences.ageMin, 25);
  assert.ok(data.genereLe, 'la date de génération horodate l’export');
});

test('les jetons techniques ne sortent JAMAIS (push_token)', async () => {
  const { data } = await exporter(BASE);
  assert.ok(!JSON.stringify(data).includes('SECRET-PUSH'), 'le jeton push n’est pas une donnée à porter');
});

test('seuls MES messages sortent — jamais ceux de l’autre personne', async () => {
  const { data } = await exporter(BASE);

  const brut = JSON.stringify(data);
  assert.ok(!brut.includes('SECRET DE TIERS'), 'un message reçu appartient à son auteur, pas à moi');

  assert.deepEqual(data.mesMessagesEnvoyes, [{
    matchId: 'match-1',
    messages: [{ contenu: 'Coucou', contenuOriginal: null, envoyeLe: '2026-02-01T10:00:00Z' }],
  }]);
});

test('aucune identité de tiers dans tout l’export (likes, matchs)', async () => {
  const { data } = await exporter(BASE);
  assert.ok(
    !JSON.stringify(data).includes(AUTRE),
    'ni un like ni un match ne doit révéler QUI est en face — sinon l’export contourne le paywall « Qui t’a liké »',
  );
  // Le like reste exporté : le petit mot, lui, est bien de moi.
  assert.equal(data.mesLikesEnvoyes[0].motJoint, 'Ton sourire');
  assert.equal(data.mesLikesEnvoyes[0].action, 'like');
  assert.equal(data.mesMatchs[0].matchId, 'match-1');
});

test('les tables qui contiennent des tiers ne sont même pas interrogées', async () => {
  const { journal } = await exporter(BASE);
  const interrogees = journal.map((q) => q.table);
  for (const interdite of ['reports', 'freeform_reports', 'blocks', 'pending_likes', 'deck_events', 'deck_impressions']) {
    assert.ok(!interrogees.includes(interdite), `${interdite} contient des tiers ou de la télémétrie : hors export`);
  }
});

test('le filtre sender_id est bien posé sur les messages', async () => {
  const { journal } = await exporter(BASE);
  const q = journal.find((x) => x.table === 'messages');
  assert.ok(q, 'les messages doivent être interrogés');
  assert.ok(
    q.filtres.some((f) => f.type === 'eq' && f.col === 'sender_id' && f.val === MOI),
    'sans ce filtre, l’export livrerait les mots d’autrui',
  );
});

test('profil introuvable → export vide mais valide (jamais de plantage)', async () => {
  const { data } = await exporter({});
  assert.equal(data.profil, null);
  assert.deepEqual(data.photos, []);
  assert.deepEqual(data.mesMessagesEnvoyes, []);
  assert.ok(data.genereLe);
});
