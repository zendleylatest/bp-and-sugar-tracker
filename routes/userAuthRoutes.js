const express = require("express");
const {
  handleGuestSession,
  handleUserLogin,
  handleUserSignUp,
  handleVerifyOTP,
  handleResendOTP,
  handleGoogleLogin,
  handleGetProfile,
  handleUpdateProfile,
  handleDeleteAccount,
  handleForgotPassword,
  handleResetPassword,
} = require("../controllers/userAuthControllers");
const {
  checkUserExistsByEmail,
  authenticate,
  optionalAuth,
} = require("../middlewares/authMiddleware");
const upload = require("../uploads");
const uploadProfile = require("../uploadsProfile");

const router = express.Router();

router.post("/guest", optionalAuth, handleGuestSession);
router.post(
  "/signup",
  optionalAuth,
  upload.single("image"),
  checkUserExistsByEmail,
  handleUserSignUp
);
router.post("/verify-otp", handleVerifyOTP);
router.post("/resend-otp", handleResendOTP);
router.post("/login", upload.single("image"), handleUserLogin);
router.post("/google-login", handleGoogleLogin);

router.get("/profile/:id", authenticate, handleGetProfile);
router.put("/profile/:id", authenticate, uploadProfile.single("profileImage"), handleUpdateProfile);
router.delete("/account", authenticate, handleDeleteAccount);

router.post("/forgot-password", handleForgotPassword);
router.post("/reset-password", handleResetPassword);

module.exports = router;
