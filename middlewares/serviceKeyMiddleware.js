/**
 * Accepts requests authenticated with X-Service-Key header instead of admin JWT.
 * Used for inter-service communication from the universal admin backend.
 * Apply as an alternative to verifyAdmin on admin routes.
 */
function verifyServiceKey(req, res, next) {
  const key = req.headers["x-service-key"];
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (expected && key === expected) {
    return next();
  }
  return res.status(401).json({ success: false, message: "Unauthorized" });
}

/**
 * Accepts either an admin JWT or a valid X-Service-Key.
 * Drop-in replacement for verifyAdmin on routes that need to support both.
 */
function verifyAdminOrServiceKey(verifyAdmin) {
  return function (req, res, next) {
    const key = req.headers["x-service-key"];
    const expected = process.env.INTERNAL_SERVICE_KEY;
    if (expected && key === expected) {
      return next();
    }
    return verifyAdmin(req, res, next);
  };
}

module.exports = { verifyServiceKey, verifyAdminOrServiceKey };
