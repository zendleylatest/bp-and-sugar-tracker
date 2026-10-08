const express = require("express");
const {
  handleGuestChat,
  handleGetCareLimits,
  handleRespond,
  handleCreateSession,
  handleListSessions,
  handleGetSession,
  handleAddMessages,
  handleUpdateSession,
  handleDeleteSession,
  handleGetEntitlement,
  handleVerifyIapPurchase,
  handleClearPremiumAfterRestore,
} = require("../controllers/chatController");
const { authenticate } = require("../middlewares/authMiddleware");

const router = express.Router();

// Guest chat — no auth required, stateless
router.get("/limits", handleGetCareLimits);
router.post("/guest", handleGuestChat);

// All routes below require a valid JWT
router.use(authenticate);

router.post("/respond", handleRespond);                   // send + get AI reply (auto-creates session)
router.get("/entitlement", handleGetEntitlement);          // premium / free-tier status
router.post("/iap/verify", handleVerifyIapPurchase);       // verify store subscription
router.post("/iap/restore-clear", handleClearPremiumAfterRestore);
router.post("/sessions", handleCreateSession);             // create session
router.get("/sessions", handleListSessions);               // list sessions
router.get("/sessions/:id", handleGetSession);             // get session + messages
router.post("/sessions/:id/messages", handleAddMessages);  // append message(s)
router.patch("/sessions/:id", handleUpdateSession);        // rename session
router.delete("/sessions/:id", handleDeleteSession);       // delete session

module.exports = router;
