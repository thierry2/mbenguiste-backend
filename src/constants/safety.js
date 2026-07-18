/**
 * Bornes du centre de sécurité — UNE seule source. Elles étaient écrites deux
 * fois (zod 1000, modèle `slice(0, 1000)`, écran 2000) : le récit d'une
 * rencontre en personne partait tronqué en silence, sans erreur, sans que
 * personne le sache. Un texte perdu là est un dossier perdu.
 *
 * Doit rester aligné avec `frontend/src/lib/safety.ts` (FREEFORM_MIN/MAX) et
 * avec la contrainte SQL `chk_freeform_body_len` (migration 024).
 */
module.exports = {
  REPORT_DETAILS_MAX: 2000,
  FREEFORM_MIN: 20,
  FREEFORM_MAX: 2000,
};
