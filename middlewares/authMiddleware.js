const User = require("../models/usersModel");
const {
  EMAIL_REQUIRED,
  USER_EXISTS,
} = require("../messages/message");
const path = require("path");
const fs = require("fs");
const { getUser } = require("../services/userAuthService");

/** JWT bearer auth — loads user from DB (same pattern as ai_image_generator_backend). */
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = getUser(token);
    const user = await User.findById(decoded._id);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account is banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }
    req.authUser = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    req.authUser = null;
    return next();
  }

  try {
    const decoded = getUser(token);
    const user = await User.findById(decoded._id);
    req.authUser = user || null;
    return next();
  } catch (_) {
    req.authUser = null;
    return next();
  }
}

async function checkUserExistsByEmail(req, res, next) {
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({ error: EMAIL_REQUIRED });
  }

  const user = await User.findOne({ email: email.trim() });
  if (user) {
    if (req.file) {
      const filePath = path.join(__dirname, "..", "uploads", req.file.filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error("Failed to delete file:", err);
      }
    }
    return res.status(409).json({ error: USER_EXISTS });
  }

  next();
}

module.exports = {
  checkUserExistsByEmail,
  authenticate,
  optionalAuth,
};
