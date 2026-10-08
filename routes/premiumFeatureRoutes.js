const express = require("express");
const {
  handleConsumePremiumFeature,
  handleGetPremiumFeatureLimits,
} = require("../controllers/premiumFeatureController");
const { authenticate } = require("../middlewares/authMiddleware");

const router = express.Router();

router.use(authenticate);
router.get("/limits", handleGetPremiumFeatureLimits);
router.post("/consume", handleConsumePremiumFeature);

module.exports = router;
