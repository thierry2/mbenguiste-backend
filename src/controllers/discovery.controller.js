const crypto = require('crypto');
const catchAsync = require('../utils/catchAsync');
const logger = require('../utils/logger');
const ApiError = require('../utils/apiError');
const config = require('../config');
const discoveryModel = require('../models/discovery.model');
const mystereModel = require('../models/mystere.model');
const accessService = require('../services/access.service');
const swipeService = require('../services/swipe.service');
const picksService = require('../services/picks.service');
const aventureService = require('../services/aventure.service');
const graphsModel = require('../models/graphs.model');
const notificationService = require('../services/notification.service');
const { filtrerMessageIntime } = require('../domain/intimeFilter');
const creditsModel = require('../models/credits.model');

/** File de profils à découvrir. */
const getCandidates = catchAsync(async (req, res) => {
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
  const profils = await discoveryModel.candidates(req.user.id, { limit });
  res.json({ success: true, data: { profils } });
});

/**
 * Enregistre un swipe. body: { action: 'pass'|'like'|'super_like' }.
 * Renvoie le match éventuel (like réciproque) pour déclencher l'écran « C'est réciproque ».
 */
const swipe = catchAsync(async (req, res) => {
  const { action, cible } = req.body;
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se swiper soi-même');

  // DEBUG_DECK=on : chaque swipe tracé, ENREGISTRÉ ou REFUSÉ (et pourquoi) —
  // le pendant serveur du deck : si un profil « revient », soit son swipe
  // n'apparaît jamais ici (perdu avant d'arriver), soit il est REFUSÉ (402).
  const debug = process.env.DEBUG_DECK === 'on';
  try {
    const { match } = await swipeService.applySwipe(req.user.id, targetId, action, cible ?? null);
    if (debug) logger.info(`[swipe] viewer=${req.user.id} ${action} → ${targetId} ENREGISTRÉ${match ? ' (MATCH)' : ''}`);
    res.json({ success: true, data: { match } });
  } catch (err) {
    if (debug) logger.warn(`[swipe] viewer=${req.user.id} ${action} → ${targetId} REFUSÉ ${err.statusCode ?? ''} ${err.details?.code ?? err.message}`);
    throw err;
  }
});

/**
 * Rewind (Lot C) : annule le dernier swipe. Réservé au palier Plus+ (le service
 * lève un 402 REWIND_LOCKED sinon). Renvoie la carte à restaurer en tête du deck.
 */
const rewind = catchAsync(async (req, res) => {
  const restore = await swipeService.rewindLast(req.user.id);
  res.json({ success: true, data: { restore } });
});

/**
 * Coups de cœur du jour (Lot E) : la sélection algorithmique du jour, visible en
 * clair par tout le monde. Le paywall est sur l'ACTION de liker (POST picks/:id/like).
 */
const dailyPicks = catchAsync(async (req, res) => {
  const picks = await picksService.dailySelection(req.user.id);
  res.json({ success: true, data: { picks } });
});

/**
 * Liker un Coup de cœur du jour. Gratuit 1×/jour, au-delà = Or (le service lève
 * un 402 PICKS_LIMIT / picks_like sinon). Renvoie le match éventuel.
 */
const likePick = catchAsync(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) throw ApiError.badRequest('On ne peut pas se liker soi-même');
  const { cible } = req.body || {};
  const { match } = await picksService.likeFromPicks(req.user.id, targetId, cible ?? null);
  res.json({ success: true, data: { match } });
});

const ONLINE_MS = 15 * 60 * 1000;

/**
 * Jeton OPAQUE d'un liker pour un viewer donné (HMAC — le client ne peut pas en
 * déduire l'identité). Sert de clé stable ; la résolution (lancer l'aventure) se
 * fera plus tard en le recomparant à la liste des likers en attente du viewer.
 */
function maskToken(viewerId, swiperId) {
  return crypto
    .createHmac('sha256', config.supabase.serviceKey)
    .update(`${viewerId}:${swiperId}`)
    .digest('base64url');
}

/**
 * « Qui t'a liké » — LA grille que vend l'Or (doctrine 15/07).
 *
 * La révélation est gatée par la CAPACITÉ `grilleDefloutee` (Or payé — jamais un
 * palier offert : invariant n°5, « la révélation ne s'offre jamais, elle se vend »),
 * jamais par un nom de palier ni par is_premium.
 *   • Sans la capacité : TOUT est masqué (jeton opaque + photo floutée). Les
 *     super-likes restent masqués eux aussi, mais MARQUÉS ⚡ — le teaser qui vend
 *     l'Or. La destinataire les découvre en clair dans son DECK (carte marquée) et
 *     par le push : c'est là que le Super Like traverse le paywall, pas ici.
 *   • Avec la capacité : tout est révélé, les super-likes épinglés en tête ⚡.
 * `premiumRequis` (= !grilleDefloutee) dit au front d'afficher le paywall.
 */
const online = (lastActiveAt) => !!lastActiveAt && Date.now() - new Date(lastActiveAt).getTime() < ONLINE_MS;

/**
 * Le Mystère — la personne à découvrir, TOUJOURS masquée, à TOUS les paliers.
 *
 * Endpoint SÉPARÉ de `/likes`, et c'est le fond du sujet. La grille des likes
 * cesse volontairement de produire des photos floutées dès que le membre a
 * `grilleDefloutee` : elle renvoie alors les photos EN CLAIR, sans `blurUrl`.
 * Y puiser la photo du Mystère la faisait donc disparaître pour tout compte Or
 * — et, plus grave, exposait à servir un jour une photo nette dans un écran qui
 * doit rester masqué. Ici la seule source atteignable est `maskedCardsByIds` :
 * le clair n'existe pas sur cette route.
 *
 * ⚠ SÉLECTION INTERIM : l'appariement quotidien n'est pas encore arrêté (il ne
 * reposera PAS sur les likes reçus). En attendant on prend le premier candidat
 * du deck — donc quelqu'un que les préférences et le score ont déjà retenu, ce
 * qui est la bonne forme. Seul ce choix bougera ; le contrat de sortie, non.
 */
/**
 * Le Mystère du membre : sa PAIRE réelle (`mystere_pairs`), servie MASQUÉE.
 *
 * Change du 20/07 : on lit désormais la vraie paire tirée par le job de passe,
 * plus le « premier candidat du deck » (béquille interim). Aucune paire → aucun
 * Mystère, et on l'assume (doctrine : mieux vaut rare et juste). Le jeton reste
 * opaque : le client ne peut pas déduire qui est en face.
 */
const mystere = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const pair = await mystereModel.pairForUser(viewerId);
  if (!pair) return res.json({ success: true, data: { mystere: null } });

  const masked = await discoveryModel.maskedCardsByIds([pair.partnerId]);
  const m = masked.get(pair.partnerId);
  // Masque HÉROS (plein écran) en priorité, repli sur le masque tuile. Aucun des
  // deux → pas de Mystère : jamais un visage révélé par accident.
  const blurUrl = m?.blurHeroUrl ?? m?.blurUrl ?? null;
  if (!blurUrl) return res.json({ success: true, data: { mystere: null } });

  // LE SCÉNARIO DE CETTE PAIRE — pour que l'onglet précharge LES BONS clips.
  // Il est dérivé de l'id de paire, donc c'est exactement celui que recevra la
  // session au lancement. Sans ça, l'onglet préchargeait un id EN DUR et se
  // trompait dès le deuxième scénario enregistré. Ne révèle rien de l'autre.
  const scenario = await graphsModel.grapheDePaire(pair.pairId);

  // LA PROGRESSION RÉELLE — le flou de la carte EST la jauge. L'onglet la
  // codait à 0 en dur : quelqu'un à une épreuve du but voyait le flou maximal
  // et « Vivre l'Aventure » au lieu de « Reprendre ». Le client ne peut pas la
  // calculer (il ne connaît pas le nœud courant hors du lecteur).
  const { etape, total } = await mystereModel.progressionDePaire(pair.pairId);

  res.json({
    success: true,
    data: {
      mystere: {
        id: maskToken(viewerId, pair.partnerId), // jeton opaque : aucune fuite d'identité
        blurUrl,
        enLigne: online(m.lastActiveAt),
        etat: pair.state,                        // 'proposed' | 'active' (aventure en cours)
        graphId: scenario?.id ?? null,           // null = aucun scénario jouable en BD
        etape,                                   // étapes franchies (jauge de flou)
        total,                                   // étapes du scénario joué
      },
    },
  });
});

/**
 * Lancer / reprendre l'Aventure : verrouille la paire et crée sa session. Rend
 * la session + MON rôle ('a'/'b') pour le Realtime. Le graphe est encore le
 * mock côté client tant que les vrais clips ne sont pas tournés.
 */
const startMystere = catchAsync(async (req, res) => {
  // Le GRAPHE EST TIRÉ AU SORT côté serveur (parmi ceux enregistrés) : le client
  // ne le choisit pas. On accepte un graphId/startNode facultatif comme SEUL repli
  // si la table de graphes est vide (utile en dev), jamais comme choix imposé.
  const { graphId, startNode } = req.body || {};
  const session = await mystereModel.startAdventure(req.user.id, { graphId, startNode });
  if (!session) throw ApiError.notFound('Aucun mystère à lancer');
  if (session.error === 'no-graph') throw ApiError.badRequest('Aucun scénario configuré (sauve un graphe dans /admin)');
  res.json({ success: true, data: { session } });
});

/**
 * Soumettre MA réponse à l'étape courante — le keystone du temps réel.
 *
 * On DÉRIVE la session de l'utilisateur (jamais un id fourni par le client :
 * impossible de répondre pour la session d'autrui). Le message intime est
 * REFILTRÉ côté serveur avant d'être écrit (jamais confiance au filtre client).
 * Le serveur tranche (domaine autoritaire) ; sa réponse dit `waiting` (l'autre
 * n'a pas encore répondu) ou l'issue résolue — c'est aussi ce que l'autre reçoit
 * en Realtime.
 */
const submitMystereAnswer = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  let answerIndex = null;
  if (body.answerIndex !== undefined && body.answerIndex !== null) {
    answerIndex = Number(body.answerIndex);
    if (answerIndex !== 0 && answerIndex !== 1) throw ApiError.badRequest('answerIndex doit valoir 0 ou 1');
  }

  const s = await mystereModel.sessionForUser(userId);
  if (!s) throw ApiError.notFound('Aucune aventure en cours');

  // Refiltrage serveur du message intime (la migration 031 le promet).
  let cleanMessage = null;
  let filtered = null;
  if (typeof body.message === 'string' && body.message.trim()) {
    const f = filtrerMessageIntime(body.message.trim());
    cleanMessage = f.clean;
    if (f.flagged) filtered = { reasons: f.reasons };
  }

  const result = await aventureService.soumettre({
    sessionId: s.sessionId, userId, answerIndex, message: cleanMessage,
  });
  if (result.error === 'not-member') throw ApiError.forbidden('Pas ta session');
  if (result.error === 'no-session') throw ApiError.notFound('Aventure introuvable');

  res.json({ success: true, data: { ...result, filtered } });
});

/**
 * Jouer le Joker — le seul achat du parcours. Dépense 1 Joker, renvoie à
 * l'épreuve finale et pose `joker_used` côté serveur (autoritaire) : la relecture
 * réussira. 402 JOKER_EMPTY si le solde est vide (le front ouvre le paywall).
 */
const playJokerMystere = catchAsync(async (req, res) => {
  const r = await mystereModel.playJoker(req.user.id);
  if (r.error === 'no-session') throw ApiError.notFound('Aucune aventure à rejouer');
  if (r.error === 'no-final') throw ApiError.badRequest('Graphe sans épreuve finale');
  if (r.error === 'no-joker') {
    throw ApiError.paymentRequired('Tu n’as pas de Joker.', { code: 'JOKER_EMPTY', source: 'mystere_joker' });
  }

  // PRÉVENIR L'AUTRE. Le Joker change TOUT pour lui : la dernière épreuve se
  // rejoue et sa réponse est de nouveau attendue. S'il est dans le lecteur, le
  // Realtime l'a déjà fait suivre ; s'il est ailleurs ou app fermée, RIEN ne le
  // lui disait — il restait devant son écran d'échec, à attendre une partie qui
  // avait repris sans lui. Best-effort : jamais au prix du Joker déjà débité.
  try {
    const membres = await mystereModel.membresDePaire(r.pairId ?? null);
    const partenaire = (membres || []).find((m) => m && m !== req.user.id);
    if (partenaire) notificationService.onMystereTurn(partenaire).catch(() => {});
  } catch (e) {
    console.error('[joker] notification partenaire:', e?.message);
  }

  res.json({ success: true, data: r });
});

/**
 * La RÉVÉLATION — le vrai profil du partenaire, une fois l'aventure GAGNÉE.
 * Le client n'a jamais eu accès à l'identité pendant le Mystère ; la victoire
 * (le match) la rend légitime. On sert le profil complet (même sérialisation que
 * le deck). `null` si l'utilisateur n'a aucune paire gagnée.
 */
const mystereReveal = catchAsync(async (req, res) => {
  const partnerId = await mystereModel.revealedPartner(req.user.id);
  if (!partnerId) return res.json({ success: true, data: { profil: null } });
  const cards = await discoveryModel.cardsByIds([partnerId]);
  res.json({ success: true, data: { profil: cards.get(partnerId) ?? null } });
});

/**
 * LES INDICES RÉELS du partenaire (texte seulement, JAMAIS la photo) — de quoi
 * remplir la carte du Mystère au fil des étapes gagnées. Le serveur DÉRIVE le
 * partenaire de la paire active (jamais un id client). On sert tout d'un coup ;
 * l'écran ne dévoile que ce que l'étape courante autorise (via `node.reveal`).
 * `{ indices: null }` s'il n'y a pas d'aventure en cours (pas une erreur : l'écran
 * retombe simplement sur les catégories verrouillées).
 */
const mystereIndices = catchAsync(async (req, res) => {
  const indices = await mystereModel.partnerIndices(req.user.id);
  res.json({ success: true, data: { indices: indices ?? null } });
});

/**
 * Un message de NÉGOCIATION (désaccord répété) : un échange libre entre les deux,
 * sur un « canal » propre au tour (nodeId synthétique côté client). Refiltré
 * serveur, enregistré SANS résolution — il ne fait pas avancer l'aventure, il
 * fait parler. L'autre le reçoit par Realtime (comme toute réponse).
 */
const submitMystereMessage = catchAsync(async (req, res) => {
  const { nodeId, message } = req.body || {};
  if (!nodeId || typeof nodeId !== 'string') throw ApiError.badRequest('nodeId requis');
  const s = await mystereModel.sessionForUser(req.user.id);
  if (!s) throw ApiError.notFound('Aucune aventure en cours');
  const role = await mystereModel.roleOf(s.pairId, req.user.id);
  if (!role) throw ApiError.forbidden('Pas ta session');
  const clean = typeof message === 'string' && message.trim()
    ? filtrerMessageIntime(message.trim()).clean : null;
  await mystereModel.recordAnswer({ sessionId: s.sessionId, nodeId, role, answerIndex: null, message: clean });
  res.json({ success: true, data: { ok: true } });
});

/**
 * TERMINER le mystère (sortie propre unilatérale). Le client confirme avant
 * d'appeler (anti-clic accidentel) ; ici on clôt la paire ('left') et on PRÉVIENT
 * le partenaire (push anonyme + il reçoit le changement de session en Realtime).
 * Best-effort sur le push : il ne doit jamais faire échouer la sortie.
 */
const leaveMystere = catchAsync(async (req, res) => {
  const r = await mystereModel.leaveMystere(req.user.id);
  if (r.error === 'no-pair') throw ApiError.notFound('Aucun mystère à terminer');
  if (r.partnerId) notificationService.onMystereEnded(r.partnerId).catch(() => {});
  res.json({ success: true, data: { ended: true } });
});

/**
 * Le GRAPHE DE PRÉSENTATION servi au client : nœuds (questions, options, clips,
 * ambiances) + routage. C'est ce que le client joue — plus de graphe en dur.
 * `null` si aucun graphe n'est enregistré → le client retombe sur son mock.
 */
const mystereGraph = catchAsync(async (req, res) => {
  const g = await graphsModel.getGraph(req.params.id);
  res.json({ success: true, data: { graph: g ? g.data : null } });
});

const likesReceived = catchAsync(async (req, res) => {
  const viewerId = req.user.id;
  const pending = await discoveryModel.likersPending(viewerId);
  const { caps } = await accessService.forUser(viewerId);
  const revele = caps.grilleDefloutee;

  if (!pending.length) {
    return res.json({ success: true, data: { coeurs: [], likes: [], premiumRequis: !revele } });
  }

  const coeursPending = pending.filter((p) => p.superLike);
  const likesPending = pending.filter((p) => !p.superLike);

  // Cartes RÉVÉLÉES : uniquement si la capacité est là — sinon rien, pas même les
  // super-likes (leur révélation se joue dans le deck, cf. en-tête).
  const revealPending = revele ? [...coeursPending, ...likesPending] : [];
  const revealIds = revealPending.map((p) => p.id);
  const cards = revealIds.length ? await discoveryModel.cardsByIds(revealIds) : new Map();
  // Coords SERVEUR ONLY → distance en km, sans jamais renvoyer la position brute.
  const coords = revealIds.length ? await discoveryModel.coordsByIds([viewerId, ...revealIds]) : new Map();
  const moi = coords.get(viewerId);
  const distanceKm = (id) => {
    const c = coords.get(id);
    if (!moi || moi.lat == null || moi.lng == null || !c || c.lat == null || c.lng == null) return null;
    return Math.round(discoveryModel.haversineKm(moi.lat, moi.lng, c.lat, c.lng));
  };
  // Accroche = 1re réponse de prompt, sinon la bio (contexte humain sur la carte).
  const accrocheDe = (c) => {
    const p = (c?.prompts ?? []).find((x) => x.reponse && x.reponse.trim());
    return (p?.reponse ?? c?.bio ?? null)?.trim() || null;
  };
  const toRevealed = (p) => {
    const c = cards.get(p.id);
    return {
      id: p.id,                          // vrai id profil (liker en retour / ouvrir profil)
      revele: true,
      superLike: p.superLike,
      prenom: c?.prenom ?? null,
      age: c?.age ?? null,
      ville: c?.villeActuelle ?? null,
      distanceKm: distanceKm(p.id),
      accroche: accrocheDe(c),
      photoUrl: c?.avatarUrl ?? c?.photos?.[0]?.url ?? null,
      estVerifie: c?.estVerifie ?? false,
      enLigne: online(c?.lastActiveAt),
    };
  };

  // Sans la capacité : tout est masqué. Les super-likes gardent leur marque ⚡
  // (le teaser qui vend l'Or), mais AUCUN champ identifiant ne sort d'ici.
  const masked = revele
    ? new Map()
    : await discoveryModel.maskedCardsByIds(pending.map((p) => p.id));
  const toMasked = (p) => {
    const m = masked.get(p.id);
    return {
      id: maskToken(viewerId, p.id),     // jeton opaque : aucune fuite d'identité
      revele: false,
      superLike: p.superLike,            // ⚡ visible, identité non
      blurUrl: m?.blurUrl ?? null,
      enLigne: online(m?.lastActiveAt),
    };
  };

  const rendre = (p) => (revele ? toRevealed(p) : toMasked(p));
  const coeurs = coeursPending.map(rendre);
  const likes = likesPending.map(rendre);

  res.json({ success: true, data: { coeurs, likes, premiumRequis: !revele } });
});

/** Active un Boost (dépense 1 crédit) : mise en avant en découverte ~30 min. */
const boost = catchAsync(async (req, res) => {
  const until = await creditsModel.spendBoost(req.user.id, config.limits.boostDurationMs);
  if (!until) throw ApiError.paymentRequired('Tu n’as pas de Boost disponible.', { code: 'BOOST_EMPTY', source: 'discover_boost' });
  res.json({ success: true, data: { boostActifJusquau: until } });
});

/**
 * Aperçu live : combien de profils correspondraient aux préférences en cours
 * d'édition (body = filtres non encore enregistrés). Alimente le compteur de la
 * page Préférences.
 */
const countCandidates = catchAsync(async (req, res) => {
  const count = await discoveryModel.countCandidates(req.user.id, req.body || {});
  res.json({ success: true, data: { count } });
});

module.exports = { getCandidates, swipe, rewind, dailyPicks, likePick, countCandidates, boost, likesReceived, mystere, startMystere, submitMystereAnswer, playJokerMystere, mystereReveal, mystereIndices, submitMystereMessage, mystereGraph, leaveMystere };
