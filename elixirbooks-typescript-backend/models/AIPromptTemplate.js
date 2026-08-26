const mongoose = require("mongoose");

const aiPromptTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    documentType: {
      type: String,
      enum: ["invoice", "purchase_order", "quotation", "expense", "any"],
      default: "any",
    },
    category: {
      type: String,
      trim: true,
      default: "General",
    },
    usageCount: {
      type: Number,
      default: 0,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AIPromptTemplate", aiPromptTemplateSchema);
