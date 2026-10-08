const mongoose = require("mongoose");

const appPromoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    screen: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.AppPromo || mongoose.model("AppPromo", appPromoSchema);
