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

  return { onSuperLikeReceived };
}

const defaultService = createNotificationService({
  sendPush: defaultSendPush,
  supabase: defaultSupabase,
});

module.exports = {
  createNotificationService,
  onSuperLikeReceived: defaultService.onSuperLikeReceived,
};
