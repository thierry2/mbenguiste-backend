const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/apiError');
const matchModel = require('../models/match.model');
const messageModel = require('../models/message.model');
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

  // Traduction éventuelle (fail-open : renvoie le texte tel quel sans clé Gemini).
  const t = await translateMessage(texte, langueLecteur || 'fr');
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
