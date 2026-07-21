'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// SONDE PUSH — la chaîne Expo → FCM → téléphone marche-t-elle, oui ou non ?
//
// POURQUOI CE SCRIPT. « Je ne reçois rien » a une dizaine de causes possibles
// (permission refusée, Expo Go, clé FCM, token périmé, réglage coupé, bug de
// notre code…) et aucune ne se distingue à l'œil nu : dans tous les cas, il ne
// se passe rien. Ce script coupe l'arbre en deux — il envoie une notification
// SANS passer par notre backend, notre base ni notre logique de jeu, puis lit le
// REÇU de livraison, qui nomme la panne.
//
// Le reçu est la seule source de vérité : l'accusé d'envoi (« ticket ») dit
// juste qu'Expo a pris le message en file. C'est quelques secondes plus tard,
// dans le reçu, qu'on apprend que FCM l'a refusé.
//
// USAGE :
//   node scripts/test-push.js "ExponentPushToken[xxxxxxxxxxxx]"
//
// Le token se lit dans Supabase → Table Editor → profiles → colonne push_token.
// S'il est VIDE, inutile de lancer ce script : le problème est côté app (elle ne
// s'est jamais enregistrée) et non côté livraison.
// ─────────────────────────────────────────────────────────────────────────────

const token = process.argv[2];

/** Ce que chaque erreur d'Expo veut VRAIMENT dire, en français. */
const DIAGNOSTIC = {
  DeviceNotRegistered:
    'Le token n’est plus valide (app désinstallée, réinstallée, ou données effacées).\n'
    + '   → Rouvre l’app pour qu’elle en enregistre un neuf, puis relis push_token en base.',
  MismatchSenderId:
    'Le google-services.json de l’app et la clé FCM chez Expo ne parlent PAS du même projet Firebase.\n'
    + '   → C’est une erreur de configuration : refais `eas credentials` (Android → FCM V1).',
  InvalidCredentials:
    'Expo n’arrive pas à s’authentifier auprès de FCM.\n'
    + '   → La clé de compte de service est absente, expirée ou révoquée côté Firebase.',
  MessageTooBig: 'Le message dépasse la taille autorisée (aucun rapport avec la configuration).',
  MessageRateExceeded: 'Trop de messages envoyés à cet appareil — réessaie dans une minute.',
};

async function main() {
  if (!token || !token.startsWith('ExponentPushToken')) {
    console.error('\n❌ Passe un token Expo en argument.\n');
    console.error('   node scripts/test-push.js "ExponentPushToken[xxxx]"\n');
    console.error('   Il se lit dans Supabase → profiles → push_token.');
    console.error('   S’il est vide en base : l’app ne s’est jamais enregistrée — le');
    console.error('   problème est côté téléphone (permission refusée, ou Expo Go, où');
    console.error('   les push distantes ne marchent plus sur Android depuis le SDK 53).\n');
    process.exit(1);
  }

  console.log('\n→ Envoi à', token.slice(0, 28) + '…\n');

  const envoi = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    // On imite EXACTEMENT ce que le vrai service envoie (canal compris) : si ce
    // test passe et que le jeu échoue, la différence n'est donc pas dans le push.
    body: JSON.stringify({
      to: token,
      title: 'Mbenguiste',
      body: 'Test de notification 🔮',
      data: { type: 'mystere_turn' },
      sound: 'default',
      channelId: 'mystere',
      priority: 'high',
    }),
  });

  const json = await envoi.json().catch(() => null);
  const ticket = json && json.data;

  if (!ticket) {
    console.error('❌ Réponse illisible d’Expo :', JSON.stringify(json));
    process.exit(1);
  }

  if (ticket.status === 'error') {
    const code = ticket.details && ticket.details.error;
    console.error('❌ REFUSÉ IMMÉDIATEMENT :', ticket.message);
    if (DIAGNOSTIC[code]) console.error('\n   ' + DIAGNOSTIC[code]);
    process.exit(1);
  }

  console.log('✔ Accepté par Expo (ticket ' + ticket.id + ')');
  console.log('  ⚠ Ça veut seulement dire « mis en file » — le vrai verdict est dans le reçu.');
  console.log('\n→ Attente du reçu de livraison (6 s)…\n');
  await new Promise((r) => setTimeout(r, 6000));

  const recuRes = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ids: [ticket.id] }),
  });
  const recuJson = await recuRes.json().catch(() => null);
  const recu = recuJson && recuJson.data && recuJson.data[ticket.id];

  if (!recu) {
    console.log('… Reçu pas encore disponible. Relance :');
    console.log('  curl -X POST https://exp.host/--/api/v2/push/getReceipts \\');
    console.log('    -H "Content-Type: application/json" \\');
    console.log('    -d \'{"ids":["' + ticket.id + '"]}\'');
    return;
  }

  if (recu.status === 'ok') {
    console.log('✅ LIVRÉ. La chaîne Expo → FCM → téléphone fonctionne.');
    console.log('   Si la notification n’apparaît pas malgré ça, la cause est SUR le');
    console.log('   téléphone : notifications coupées pour l’app, mode Ne pas déranger,');
    console.log('   ou économie de batterie agressive (Xiaomi/Huawei/Oppo).');
    return;
  }

  const code = recu.details && recu.details.error;
  console.error('❌ NON LIVRÉ :', recu.message);
  if (DIAGNOSTIC[code]) console.error('\n   ' + DIAGNOSTIC[code]);
  else console.error('\n   Code brut :', code || '(aucun)');
  process.exit(1);
}

main().catch((e) => { console.error('❌ Échec réseau :', e.message); process.exit(1); });
