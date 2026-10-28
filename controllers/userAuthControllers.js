const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { setUser } = require("../services/userAuthService");
const {
  sendOTPEmail,
  sendEmail,
  buildOtpEmailHtml,
  logOtp,
} = require("../services/emailService");
const User = require("../models/usersModel");
const ChatSession = require("../models/chatModel");
const ChatUsage = require("../models/chatUsageModel");
const PromptGeneration = require("../models/promptGenerationModel");
const PushDeviceToken = require("../models/pushDeviceTokenModel");
const {
  NETWORK_ERROR,
  SIGNED_UP,
  SIGN_UP_FAILED,
  USER_NOT_FOUND,
  WRONG_PASSWORD,
  LOGGED_IN,
  ALL_FILEDS_REQUIRED,
  NAME_REQUIRED,
  EMAIL_REQUIRED,
  PASSWORD_REQUIRED,
  OTP_SEND_FAILED,
  INVALID_OTP,
  EMAIL_NOT_VERIFIED,
  USER_ID_OTP_REQUIRED,
} = require("../messages/message");
const { isGuestUser } = require("../services/careLimitService");

// GOOGLE_CLIENT_ID may hold several comma-separated OAuth client IDs. The ID
// token's audience is the Web client ID the app passes as serverClientId.
const googleAudiences = (process.env.GOOGLE_CLIENT_ID || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const googleClient = googleAudiences.length ? new OAuth2Client() : null;

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidOTP = (otp) => typeof otp === "string" && /^\d{6}$/.test(otp);

async function handleUserSignUp(req, res) {
  const body = req.body;
  if (!body) return res.status(400).json({ message: ALL_FILEDS_REQUIRED });
  if (!body.name) return res.status(400).json({ message: NAME_REQUIRED });
  if (!body.email) return res.status(400).json({ message: EMAIL_REQUIRED });
  if (!body.password) return res.status(400).json({ message: PASSWORD_REQUIRED });

  try {
    const hashed = await bcrypt.hash(body.password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const convertedGuest = req.authUser && isGuestUser(req.authUser);

    let result;
    if (convertedGuest) {
      result = await User.findById(req.authUser._id);
      if (!result) return res.status(401).json({ error: USER_NOT_FOUND });
      result.name = body.name;
      result.email = body.email.trim();
      result.profession = body.profession ?? result.profession;
      result.password = hashed;
      result.image = req.file ? `/uploads/${req.file.filename}` : result.image;
      result.otp = otp;
      result.emailVerified = false;
      await result.save();
    } else {
      result = await User.create({
        name: body.name,
        email: body.email,
        profession: body.profession ?? undefined,
        password: hashed,
        image: req.file ? `/uploads/${req.file.filename}` : null,
        otp,
        emailVerified: false,
      });
    }

    try {
      await sendOTPEmail(body.email.trim(), otp);
    } catch (mailErr) {
      console.error("OTP email error:", mailErr);
      if (!convertedGuest) await User.findByIdAndDelete(result._id);
      return res.status(500).json({ error: OTP_SEND_FAILED });
    }

    res.status(201).json({
      message: "User created. OTP sent to email.",
      userId: result._id,
      success: SIGNED_UP,
    });
  } catch (err) {
    console.error("DB create error:", err);
    res.status(500).json({ error: SIGN_UP_FAILED });
  }
}

async function handleVerifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (
      userId == null ||
      otp === undefined ||
      otp === null ||
      String(otp).trim() === ""
    ) {
      return res.status(400).json({ error: USER_ID_OTP_REQUIRED });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ error: USER_NOT_FOUND });
    }

    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account has been banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    if (user.otp !== String(otp).trim()) {
      return res.status(400).json({ error: INVALID_OTP });
    }

    user.emailVerified = true;
    user.otp = null;
    await user.save();

    res.json({ message: "Email verified successfully." });
  } catch (err) {
    console.error("verify OTP error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleUserLogin(req, res) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: USER_NOT_FOUND });
    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account is banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    if (user.emailVerified === false) {
      return res.status(400).json({ error: EMAIL_NOT_VERIFIED });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: WRONG_PASSWORD });
    const token = setUser(user);

    res.json({
      success: LOGGED_IN,
      userId: user._id,
      token: token,
      username: user.name,
      useremail: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleGoogleLogin(req, res) {
  try {
    if (!googleClient || !googleAudiences.length) {
      return res.status(500).json({ error: "Google sign-in is not configured" });
    }
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: "Google ID token required" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleAudiences,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    const { sub, email, name, email_verified, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || "Google User",
        email,
        googleId: sub,
        emailVerified: email_verified !== false,
        image: picture || undefined,
      });
    } else {
      let updated = false;
      if (!user.googleId) {
        user.googleId = sub;
        updated = true;
      }
      if (!user.image && picture) {
        user.image = picture;
        updated = true;
      }
      if (!user.emailVerified && email_verified) {
        user.emailVerified = true;
        updated = true;
      }
      if (updated) await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account is banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    const token = setUser(user);
    res.json({
      token,
      id: user._id,
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(500).json({ error: "Google authentication failed" });
  }
}

async function handleGetProfile(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await User.findById(id).select(
      "-otp -resetOTP -password -emailVerified"
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    const o = user.toObject();
    o.fullName = o.name;
    res.json(o);
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleUpdateProfile(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.body.newPassword && !req.body.oldPassword) {
      return res.status(400).json({ message: "Old password required" });
    }

    if (req.body.oldPassword && req.body.newPassword) {
      const ok = await bcrypt.compare(req.body.oldPassword, user.password || "");
      if (!ok) {
        return res.status(400).json({ message: "Old password is incorrect" });
      }
    }

    const updates = {};
    const displayName = req.body.fullName ?? req.body.name;
    if (displayName) updates.name = displayName;
    if (req.body.newPassword) {
      updates.password = await bcrypt.hash(req.body.newPassword, 10);
    }
    if (req.file) {
      updates.image = `/uploads/profile/${req.file.filename}`;
    }

    const cp = req.body.creationsPublic;
    if (cp !== undefined && cp !== null && cp !== "") {
      if (cp === true || cp === "true" || cp === "1") {
        updates.creationsPublic = true;
      } else if (cp === false || cp === "false" || cp === "0") {
        updates.creationsPublic = false;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No data to update" });
    }

    await User.findByIdAndUpdate(id, updates, { new: true });
    res.json("Your Information Updated");
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function handleDeleteAccount(req, res) {
  try {
    const user = req.authUser;
    if (!user?._id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = user._id;
    const userEmail = user.email ? user.email.toString().trim().toLowerCase() : "";

    await Promise.all([
      ChatSession.deleteMany({ userId }),
      ChatUsage.deleteMany({ userId }),
      PromptGeneration.deleteMany({
        $or: [
          { userId },
          ...(userEmail ? [{ generatedBy: userEmail }] : []),
        ],
      }),
      PushDeviceToken.deleteMany({ userId: userId.toString() }),
    ]);

    await User.deleteOne({ _id: userId });

    res.json({
      message: "Account permanently deleted.",
    });
  } catch (err) {
    console.error("deleteAccount error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleGuestSession(req, res) {
  try {
    if (req.authUser && isGuestUser(req.authUser)) {
      const token = setUser(req.authUser);
      return res.json({
        success: true,
        userId: req.authUser._id,
        token,
        username: req.authUser.name || "Guest",
        useremail: req.authUser.email,
        isGuest: true,
      });
    }

    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");
    const user = await User.create({
      name: "Guest",
      email: `guest_${id}@wellorahealth.app`,
      password: await bcrypt.hash(crypto.randomBytes(18).toString("hex"), 10),
      emailVerified: false,
    });
    const token = setUser(user);

    return res.status(201).json({
      success: true,
      userId: user._id,
      token,
      username: user.name,
      useremail: user.email,
      isGuest: true,
    });
  } catch (err) {
    console.error("guest session error:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleResendOTP(req, res) {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: USER_ID_OTP_REQUIRED });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ error: USER_NOT_FOUND });
    }
    if (user.emailVerified) {
      return res.json({ message: "Email is already verified." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    await user.save();
    await sendOTPEmail(user.email, otp);

    return res.json({ message: "OTP sent successfully." });
  } catch (err) {
    console.error("resend OTP error:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleForgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    await user.save();

    logOtp(email, otp, "password reset");
    await sendEmail(
      email,
      "Reset your Blood Pressure & Sugar Tracker password",
      `Your Blood Pressure & Sugar Tracker password reset code is: ${otp}`,
      {
        html: buildOtpEmailHtml({
          title: "Reset your password",
          preheader: `Your Blood Pressure & Sugar Tracker password reset code is ${otp}.`,
          otp,
          message:
            "Use this one-time code to reset your Blood Pressure & Sugar Tracker password and get back into your account.",
        }),
      }
    );
    res.json({ message: "OTP sent" });
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleResetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }
    if (!isValidOTP(String(otp).trim())) {
      return res.status(400).json({ error: "Invalid OTP format" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email, resetOTP: String(otp).trim() });
    if (!user) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOTP = null;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

module.exports = {
  handleGuestSession,
  handleUserSignUp,
  handleUserLogin,
  handleVerifyOTP,
  handleResendOTP,
  handleGoogleLogin,
  handleGetProfile,
  handleUpdateProfile,
  handleDeleteAccount,
  handleForgotPassword,
  handleResetPassword,
};
