const mongoose = require("mongoose");

const chatUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatSession",
      index: true,
      default: null,
    },
    requestType: {
      type: String,
      enum: ["guest", "authenticated", "faq-chat"],
      default: "authenticated",
    },
    model: {
      type: String,
      default: "",
    },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatUsage", chatUsageSchema);
