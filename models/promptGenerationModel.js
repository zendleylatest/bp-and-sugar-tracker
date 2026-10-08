const mongoose = require("mongoose");

const promptGenerationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },
    generatedBy: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    input: { type: String, required: true, trim: true },
    generatedPrompt: { type: String, required: true, trim: true },
    model: { type: String, default: "" },
    usage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PromptGeneration", promptGenerationSchema);
