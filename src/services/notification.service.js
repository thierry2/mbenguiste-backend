'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Déclencheurs de notifications. Mbenguiste n'a pas de cloche in-app : une
// notification EST un push (rien à stocker).
//
// Doctrine du Super Like (docs/doctrine-offres.md) : le push est ANONYME
// (« quelqu'un t'a envoyé un Super Like ») — c'est un TEASER qui ramène dans
// l'app. La révélation, elle, se joue dans le DECK (carte marquée en clair).
// Ne jamais mettre le prénom ni l'avatar de l'envoyeur ici : ce serait donner
// gratuitement ce que la grille défloutée (Or) vend.
//
// Factory à dépendances injectées + instance par défaut pour les services.
// ─────────────────────────────────────────────────────────────────────────────
const defaultSupabase = require('../config/supabase');
const { sendPush: defaultSendPush } = require('./expoPush.service');

function createNotificationService({ sendPush, supabase }) {
  /**
   * Le réglage utilisateur a-t-il coupé les push ? Fail-open : en cas d'erreur
   * on envoie quand même (mieux vaut une alerte en trop qu'un réglage qui casse
   * silencieusement toutes les alertes).
   */
  async function _isPushOff(userId) {
    try {
      const { data } = await supabase
        .from('profiles').select('notif_push').eq('id', userId).maybeSingle();
      return data?.notif_push === false;
    } catch { return false; }
  }

  /**
   * Quelqu'un vient de recevoir un Super Like. Best-effort : un échec de push ne
   * doit JAMAIS casser le swipe qui l'a déclenché.
   */
  async function onSuperLikeReceived(targetId) {
    try {
      if (await _isPushOff(targetId)) return;
      await sendPush(targetId, {
        // Formulation neutre en genre : l'app s'adresse aux deux.
        title: 'Mbenguiste',
        body: 'Quelqu\'un t\'a envoyé un Super Like ⚡',
        data: { type: 'super_like' },
      });
    } catch (e) {
      console.error('[notif] onSuperLikeReceived:', e?.message);
    }
  }

  /**
   * Décision de vérification (validée / refusée). La revue humaine peut prendre
   * plusieurs jours : sans push, la personne devrait rouvrir l'écran au hasard
   * pour savoir. Best-effort, comme le reste.
   *
   * On ne détaille PAS le motif de refus ici — il s'affiche dans l'app, où il y
   * a la place de l'expliquer et de proposer de recommencer.
   */
  async function onVerificationDecided(userId, approved) {
    try {
      if (await _isPushOff(userId)) return;
      await sendPush(userId, {
        title: 'Mbenguiste',
        body: approved
          ? 'Ton profil est vérifié ✅'
          : 'Ta vérification n\'a pas pu être validée — tu peux réessayer',
        data: { type: 'verification', approved },
      });
    } catch (e) {
      console.error('[notif] onVerificationDecided:', e?.message);
    }
  }

  /**
   * Le mystère de quelqu'un vient d'être TERMINÉ par l'autre (sortie propre).
   * Sans ce push, le partenaire attendrait une réponse qui ne viendra jamais.
   * ANONYME par doctrine : on ne dit ni QUI a mis fin, ni son prénom — juste que
   * le mystère est fini (l'app ne révèle jamais l'identité hors victoire).
   * Best-effort : un échec de push ne casse jamais la sortie qui l'a déclenché.
   */
  async function onMystereEnded(userId) {
    try {
      if (await _isPushOff(userId)) return;
      await sendPush(userId, {
        title: 'Mbenguiste',
        body: 'Ton mystère a pris fin.',
        data: { type: 'mystere_ended' },
      });
    } catch (e) {
      console.error('[notif] onMystereEnded:', e?.message);
    }
  }

  /**
   * Une nouvelle paire vient de naître : un mystère ATTEND cette personne. Sans
   * ce push, il faudrait ouvrir l'onglet au hasard pour le découvrir (la table
   * `mystere_pairs` est fermée au client — pas de Realtime possible sans exposer
   * l'identité ; le push, lui, ne porte AUCUNE identité). ANONYME par doctrine :
   * juste « quelqu'un t'attend », jamais le prénom ni l'avatar. Best-effort : un
   * échec de push ne doit jamais faire échouer l'appariement qui l'a déclenché.
   */
  async function onMystereProposed(userId) {
    try {
      if (await _isPushOff(userId)) return;
      await sendPush(userId, {
        title: 'Mbenguiste',
        body: 'Un mystère t\'attend 🔮',
        data: { type: 'mystere_proposed' },
      });
    } catch (e) {
      console.error('[notif] onMystereProposed:', e?.message);
    }
  }

  /**
   * TON BINÔME A JOUÉ — c'est à toi. LA notification du jeu : l'Aventure est
   * asynchrone, les deux joueurs peuvent être séparés par des heures, et sans
   * elle il fallait ouvrir l'onglet au hasard pour découvrir qu'on nous
   * attendait (des parties mouraient d'attente). Le tap ramène DIRECTEMENT dans
   * l'aventure, qui reprend au nœud courant (cf. routage front).
   *
   * ANONYME comme tout le reste : on dit qu'on t'attend, jamais qui.
   */
  async function onMystereTurn(userId) {
    try {
      if (await _isPushOff(userId)) return;
      await sendPush(userId, {
        title: 'Mbenguiste',
        body: 'Ton binôme a joué. À toi 🔮',
        data: { type: 'mystere_turn' },
      });
    } catch (e) {
      console.error('[notif] onMystereTurn:', e?.message);
    }
  }

  /**
   * L'AVENTURE EST GAGNÉE — le visage tombe. C'est le seul moment où l'autre
   * cesse d'être anonyme… mais la notification, elle, reste muette sur son
   * identité : la révélation se joue DANS l'app, jamais dans la barre de
   * notifications (on ne dévoile pas un visage sur un écran verrouillé).
   */
  async function onMystereReveal(userId) {
    try {
      if (await _isPushOff(userId)) return;
      await sendPush(userId, {
        title: 'Mbenguiste',
        body: 'Vous avez réussi. Le visage se dévoile ✨',
        data: { type: 'mystere_reveal' },
      });
    } catch (e) {
      console.error('[notif] onMystereReveal:', e?.message);
    }
  }

  return {
    onSuperLikeReceived, onVerificationDecided,
    onMystereEnded, onMystereProposed, onMystereTurn, onMystereReveal,
  };
}

const defaultService = createNotificationService({
  sendPush: defaultSendPush,
  supabase: defaultSupabase,
});

module.exports = {
  createNotificationService,
  onSuperLikeReceived: defaultService.onSuperLikeReceived,
  onVerificationDecided: defaultService.onVerificationDecided,
  onMystereEnded: defaultService.onMystereEnded,
  onMystereProposed: defaultService.onMystereProposed,
  onMystereTurn: defaultService.onMystereTurn,
  onMystereReveal: defaultService.onMystereReveal,
};
