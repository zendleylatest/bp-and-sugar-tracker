const mongoose = require("mongoose");

const knowledgeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: null,
    },
    content: {
      type: String,
      required: [true, "Knowledge content is required"],
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    addedBy: {
      type: String,
      default: "api",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

knowledgeSchema.index({ title: "text", content: "text", category: "text" });
knowledgeSchema.index({ category: 1, active: 1 });
knowledgeSchema.index({ active: 1, createdAt: -1 });

module.exports = mongoose.model("Knowledge", knowledgeSchema);
