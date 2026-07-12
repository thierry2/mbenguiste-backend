const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const config = require('../config');
const matchModel = require('../models/match.model');
const messageModel = require('../models/message.model');
const profileModel = require('../models/profile.model');
const usage = require('../models/usage.model');
const { translateMessage } = require('../services/translation.service');
const { uploadChatImage } = require('../services/upload.service');

/** Garde-fou : l'utilisateur appartient-il bien à ce match (et est-il actif) ? */
async function assertMember(matchId, userId) {
  const match = await matchModel.getForUser(matchId, userId);
  if (!match) throw ApiError.notFound('Match introuvable');
  if (!match.actif) throw ApiError.forbidden('Cette conversation est close');
  return match;
}

const listMessages = catchAsync(async (req, res) => {
  await assertMember(req.params.id, req.user.id);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '30', 10)));
  const before = req.query.before || undefined;
  const messages = await messageModel.list(req.params.id, req.user.id, { before, limit });
  res.json({ success: true, data: { messages } });
});

const send = catchAsync(async (req, res) => {
  await assertMember(req.params.id, req.user.id);
  const { texte, langueLecteur } = req.body;

  // Traduction : ILLIMITÉE pour l'Or, sinon dans la limite du quota gratuit.
  // JAMAIS bloquant — au-delà du quota, le message part simplement non traduit
  // (on ne casse jamais un envoi pour une histoire de traduction). On ne décompte
  // le quota que si une traduction a RÉELLEMENT eu lieu (un message déjà en
  // français ne consomme rien).
  let t = { body: texte, originalBody: null, sourceLanguage: null, isTranslated: false };
  const premium = await profileModel.isPremium(req.user.id);
  const allowed = premium
    || (await usage.remaining(req.user.id, 'translation', config.limits.freeTranslationsPerDay)).remaining > 0;
  if (allowed) {
    t = await translateMessage(texte, langueLecteur || 'fr');
    if (!premium && t.isTranslated) {
      await usage.consume(req.user.id, 'translation', config.limits.freeTranslationsPerDay);
    }
  }

  const message = await messageModel.send(req.params.id, req.user.id, {
    body: t.body,
    originalBody: t.originalBody,
    sourceLanguage: t.sourceLanguage,
    isTranslated: t.isTranslated,
  });
  res.status(201).json({ success: true, data: { message } });
});

/** POST /matches/:id/messages/image — envoie une image (multipart, champ `file`). */
const sendImage = catchAsync(async (req, res) => {
  await assertMember(req.params.id, req.user.id);
  if (!req.file) throw ApiError.badRequest('Aucun fichier reçu');
  const { path, type } = await uploadChatImage(req.file, req.user.id);
  const message = await messageModel.send(req.params.id, req.user.id, { mediaPath: path, mediaType: type });
  res.status(201).json({ success: true, data: { message } });
});

/** GET /matches/:id/messages/:messageId/media-url — (re)signe l'URL d'un média.
 *  Appelé par le front quand un message image arrive par Realtime (chemin brut non ouvrable). */
const mediaUrl = catchAsync(async (req, res) => {
  await assertMember(req.params.id, req.user.id);
  const url = await messageModel.signOne(req.params.id, req.params.messageId);
  res.json({ success: true, data: { url } });
});

const markRead = catchAsync(async (req, res) => {
  await assertMember(req.params.id, req.user.id);
  await messageModel.markRead(req.params.id, req.user.id);
  res.json({ success: true });
});

const unreadCount = catchAsync(async (req, res) => {
  const count = await messageModel.unreadCount(req.user.id);
  res.json({ success: true, data: { count } });
});

module.exports = { listMessages, send, sendImage, mediaUrl, markRead, unreadCount };
