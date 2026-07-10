const config = require('../config');
const logger = require('../utils/logger');

// Client Gemini chargé paresseusement (une seule fois) pour ne pas peser au démarrage.
let model = null;
function getModel() {
  if (model || !config.gemini.apiKey) return model;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genai = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genai.getGenerativeModel({ model: config.gemini.model });
  } catch (e) {
    logger.warn(`Traduction indisponible (@google/generative-ai) : ${e.message}`);
  }
  return model;
}

/**
 * Traduit le texte d'un message vers `targetLang` (langue du lecteur), en
 * préservant le sens de l'argot (nouchi, wolof, camfranglais…). C'est ce qui
 * permet à deux personnes de continents différents de vraiment se comprendre.
 *
 * FAIL-OPEN : sans clé API ou en cas d'erreur, on renvoie le texte tel quel,
 * sans marquer de traduction — jamais bloquant pour l'envoi d'un message.
 *
 * @returns {{ body, originalBody, sourceLanguage, isTranslated }}
 */
async function translateMessage(text, targetLang = 'fr') {
  const passthrough = { body: text, originalBody: null, sourceLanguage: null, isTranslated: false };
  const m = getModel();
  if (!m || !text?.trim()) return passthrough;

  try {
    const prompt =
      `Tu es un traducteur pour une app de rencontre. Détecte la langue ou l'argot du message ` +
      `suivant. S'il est déjà en "${targetLang}" courant, renvoie-le inchangé. Sinon, traduis-le ` +
      `en "${targetLang}" naturel en gardant le ton chaleureux. Réponds STRICTEMENT en JSON : ` +
      `{"translated": "...", "sourceLanguage": "...", "changed": true|false}\n\nMessage : ${text}`;

    const res = await m.generateContent(prompt);
    const raw = res.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
    const parsed = JSON.parse(raw);
    if (!parsed.changed) return passthrough;

    return {
      body: parsed.translated,
      originalBody: text,
      sourceLanguage: parsed.sourceLanguage || null,
      isTranslated: true,
    };
  } catch (e) {
    logger.warn(`Traduction échouée, envoi du texte original : ${e.message}`);
    return passthrough;
  }
}

module.exports = { translateMessage };
