const express = require("express");
const { verifyAdmin } = require("../middlewares/adminAuthMiddleware");
const { verifyAdminOrServiceKey } = require("../middlewares/serviceKeyMiddleware");
const {
  getUsers,
  updateUser,
  setUserBanState,
  getUsageOverview,
  broadcastNotification,
  getChatUsageOverview,
  getUserChatUsage,
  getGuestChatStats,
} = require("../controllers/adminController");

const router = express.Router();

router.get("/test", (req, res) => {
  res.json({ success: true, message: "Admin routes are working" });
});

const adminOrService = verifyAdminOrServiceKey(verifyAdmin);
router.use(adminOrService);
router.get("/users", getUsers);
router.put("/users/:id", updateUser);
router.patch("/users/:id/ban", setUserBanState);
router.patch("/users/:id/toggle", setUserBanState);
router.get("/usage", getUsageOverview);
router.post("/notifications/broadcast", broadcastNotification);

// Chat usage tracking endpoints
router.get("/chat/usage", getChatUsageOverview);
router.get("/chat/usage/user/:userId", getUserChatUsage);
router.get("/chat/usage/guest", getGuestChatStats);

module.exports = router;
