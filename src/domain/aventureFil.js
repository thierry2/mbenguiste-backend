'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// LE FIL DE L'AVENTURE → LA CONVERSATION.
//
// Au match, la conversation ne s'ouvre plus sur du vide : elle s'ouvre sur CE
// QUE LES DEUX SE SONT DÉJÀ ÉCRIT pendant l'Aventure — l'aveu du nœud intime et
// les messages échangés pour sortir d'un désaccord.
//
// LE SENS. Ces mots ont été écrits sous anonymat : l'autre s'appelait
// « MYSTÈRE », sans prénom ni genre. Ils reprennent ici leur auteur réel. Ce
// n'est pas une trahison du secret — le secret, c'était le VISAGE, et il vient
// d'être gagné. C'est au contraire ce qui donne sa valeur au premier écran de
// la conversation : ces deux-là ne se découvrent pas, ils se retrouvent.
//
// Ce module est PUR (aucune I/O) : il transforme des lignes `aventure_answers`
// en lignes `messages`. C'est ce qui le rend testable au cas près.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `role` → l'identité réelle. La paire ordonne ses membres (`user_low` /
 * `user_high`) et le rôle en découle (cf. `roleDe`, domain/mystere).
 */
function auteurDuRole(pair, role) {
  if (!pair) return null;
  if (role === 'a') return pair.user_low || null;
  if (role === 'b') return pair.user_high || null;
  return null;
}

/**
 * Les messages à insérer, dans l'ordre où ils ont été dits.
 *
 * @param rows    lignes `aventure_answers` de la session (ordre indifférent)
 * @param pair    { user_low, user_high }
 * @param matchId la conversation qui vient d'être créée
 * @returns lignes prêtes pour `messages` — jamais d'auteur nul, jamais de vide
 */
function messagesDuFil({ rows, pair, matchId }) {
  if (!matchId || !Array.isArray(rows)) return [];

  return rows
    .filter(Boolean)
    .map((r) => {
      // Seul le TEXTE fait un message. Une épreuve n'enregistre qu'un
      // `answer_index` : la verser produirait des bulles vides — ou pire, « 0 ».
      const body = typeof r.message_text === 'string' ? r.message_text.trim() : '';
      // `sender_id` est NOT NULL en base : une ligne sans auteur identifiable
      // ferait échouer TOUT l'insert, et la conversation s'ouvrirait vide sans
      // qu'on sache pourquoi. On l'écarte ici plutôt que de le découvrir là-bas.
      const sender = auteurDuRole(pair, r.role);
      if (!body || !sender) return null;
      return {
        match_id: matchId,
        sender_id: sender,
        body,
        // ON GARDE L'HORODATAGE D'ORIGINE : ces mots datent d'AVANT le match.
        // Tout insérer à `now()` écraserait la chronologie et mêlerait les
        // négociations du début à l'aveu de la fin.
        created_at: r.created_at,
      };
    })
    .filter(Boolean)
    .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
}

module.exports = { messagesDuFil };
