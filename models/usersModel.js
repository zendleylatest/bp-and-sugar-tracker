const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
    },
    profession: {
      type: String,
    },
    password: {
      type: String,
    },
    image: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
    otp: {
      type: String,
    },
    emailVerified: {
      type: Boolean,
    },
    googleId: {
      type: String,
    },
    resetOTP: {
      type: String,
    },
    creationsPublic: {
      type: Boolean,
      default: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },
    bannedAt: {
      type: Date,
      default: null,
    },
    bannedReason: {
      type: String,
      default: "",
      trim: true,
    },
    deviceTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        deviceType: {
          type: String,
          default: "unknown",
        },
        deviceInfo: {
          os: { type: String, default: "" },
          appVersion: { type: String, default: "" },
        },
        registeredAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    openAiUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      requestCount: { type: Number, default: 0 },
      lastUsedAt: { type: Date, default: null },
    },
    subscriptionPlan: {
      type: String,
      enum: ["Free", "Premium"],
      default: "Free",
    },
    isPro: {
      type: Boolean,
      default: false,
    },
    subscription: {
      platform: {
        type: String,
        enum: ["android", "ios", "web", "amazon", "none"],
        default: "none",
      },
      productId: { type: String, trim: true },
      purchaseToken: { type: String, trim: true },
      storeUserId: { type: String, trim: true },
      originalTransactionId: { type: String, trim: true },
      status: {
        type: String,
        enum: ["inactive", "active", "expired", "cancelled", "verify_failed", "unsupported"],
        default: "inactive",
      },
      expiresAt: Date,
      lastVerifiedAt: Date,
      lastVerifyAttemptAt: Date,
      lastVerifyError: { type: String },
      // null = unknown (store didn't say); false = user cancelled renewal.
      autoRenewing: { type: Boolean, default: null },
      isTrial: { type: Boolean, default: false },
      source: {
        type: String,
        default: "none",
      },
    },
    careUsage: {
      totalMessagesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      updatedAt: Date,
    },
    premiumFeatureUsage: {
      reportsUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      fullDataAccessUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      bmiEntriesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      bloodPressureEntriesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      bloodGlucoseEntriesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

module.exports = User;
