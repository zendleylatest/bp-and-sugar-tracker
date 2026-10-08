const mongoose = require("mongoose");

/**
 * Standalone FCM tokens (admin-service style): only [token] is required.
 * Optional [userId] is an arbitrary label (e.g. "guest_user"), not a Mongo ref.
 * Logged-in installs also use User.deviceTokens; this collection is cleaned when they register on a User.
 */
const pushDeviceTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      default: null,
      trim: true,
    },
    deviceType: { type: String, default: "unknown", trim: true },
    deviceInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    isActive: { type: Boolean, default: true },
    registeredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PushDeviceToken", pushDeviceTokenSchema);
