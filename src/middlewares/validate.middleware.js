const ApiError = require('../utils/apiError');

/**
 * Validation basée sur un schéma Zod. On valide body / query / params et on
 * remplace les valeurs par les versions parsées.
 *
 *   const schema = z.object({ body: z.object({ ... }) });
 *   router.post('/', validate(schema), handler);
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(ApiError.badRequest('Données invalides', details));
    }

    if (result.data.body) req.body = result.data.body;
    if (result.data.params) req.params = result.data.params;
    // req.query est en lecture seule sur Express 5 : on l'attache à part.
    if (result.data.query) req.validatedQuery = result.data.query;

    next();
  };
}

module.exports = validate;
