/**
 * Enveloppe un handler async pour transmettre toute erreur à next()
 * sans try/catch dans chaque controller.
 */
module.exports = function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
