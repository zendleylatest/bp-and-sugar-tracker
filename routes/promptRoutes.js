const express = require("express");
const {
  handleGeneratePrompt,
  handleListPrompts,
  handleGetPrompt,
} = require("../controllers/promptController");
const { authenticate, optionalAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/generate", optionalAuth, handleGeneratePrompt);
router.get("/", authenticate, handleListPrompts);
router.get("/:id", authenticate, handleGetPrompt);

module.exports = router;
