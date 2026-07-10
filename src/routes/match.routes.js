const express = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { memoryUpload } = require('../middlewares/upload.middleware');
const messageSchemas = require('../validations/message.validation');
const matchC = require('../controllers/match.controller');
const msgC = require('../controllers/message.controller');

const router = express.Router();

// Liste des matchs (= liste des conversations).
router.get('/', authenticate, matchC.list);
// Badge onglet messages.
router.get('/unread-count', authenticate, msgC.unreadCount);

router.get('/:id', authenticate, matchC.getOne);
router.delete('/:id', authenticate, matchC.unmatch);

// Messages d'un match.
router.get('/:id/messages', authenticate, msgC.listMessages);
router.post('/:id/messages', authenticate, validate(messageSchemas.send), msgC.send);
router.post('/:id/messages/image', authenticate, memoryUpload.single('file'), msgC.sendImage);
router.get('/:id/messages/:messageId/media-url', authenticate, msgC.mediaUrl);
router.post('/:id/read', authenticate, msgC.markRead);

module.exports = router;
