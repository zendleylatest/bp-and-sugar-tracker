const { verifyAdmin } = require("./adminAuthMiddleware");

function requireKnowledgeAuth(req, res, next) {
  const serviceKey = req.get("X-Service-Key")?.trim();
  const internalKey = process.env.INTERNAL_SERVICE_KEY;
  if (internalKey && serviceKey === internalKey) {
    req.knowledgeAuthMethod = "service-key";
    return next();
  }

  const knowledgeKey = req.get("X-Knowledge-Key")?.trim();
  const expectedKnowledgeKey = process.env.KNOWLEDGE_API_KEY;
  if (expectedKnowledgeKey && knowledgeKey === expectedKnowledgeKey) {
    req.knowledgeAuthMethod = "api-key";
    return next();
  }

  const bearer = req.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (expectedKnowledgeKey && bearer === expectedKnowledgeKey) {
    req.knowledgeAuthMethod = "api-key";
    return next();
  }

  return verifyAdmin(req, res, (error) => {
    if (error) return next(error);
    req.knowledgeAuthMethod = "admin-jwt";
    return next();
  });
}

module.exports = { requireKnowledgeAuth };
