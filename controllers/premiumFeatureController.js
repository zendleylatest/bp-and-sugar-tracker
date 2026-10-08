const User = require("../models/usersModel");
const {
  buildPremiumFeatureLimits,
  consumePremiumFeature,
  normalizeFeature,
} = require("../services/premiumFeatureLimitService");

async function handleGetPremiumFeatureLimits(req, res) {
  try {
    const user = await User.findById(req.authUser._id);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({
      success: true,
      entitlement: buildPremiumFeatureLimits(user),
    });
  } catch (err) {
    console.error("[premium features limits]", err);
    return res.status(500).json({ error: "Failed to fetch premium limits" });
  }
}

async function handleConsumePremiumFeature(req, res) {
  try {
    const user = await User.findById(req.authUser._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const feature = normalizeFeature(req.body?.feature);
    if (!feature) {
      return res.status(400).json({
        error:
          "feature must be reports, fullDataAccess, bmiEntries, bloodPressureEntries, or bloodGlucoseEntries",
        entitlement: buildPremiumFeatureLimits(user),
      });
    }

    const entitlement = await consumePremiumFeature(user, feature);
    return res.json({
      success: true,
      entitlement,
      feature,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) {
      console.error("[premium features consume]", err);
    }
    const user = req.authUser ? await User.findById(req.authUser._id) : null;
    return res.status(status).json({
      error: err.message || "Failed to consume premium feature",
      code: status === 402 ? "PREMIUM_FEATURE_LIMIT_REACHED" : undefined,
      feature: err.feature,
      entitlement: user ? buildPremiumFeatureLimits(user) : undefined,
    });
  }
}

module.exports = {
  handleConsumePremiumFeature,
  handleGetPremiumFeatureLimits,
};
