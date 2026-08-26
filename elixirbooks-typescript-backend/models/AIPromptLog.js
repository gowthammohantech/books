const mongoose = require("mongoose");

const aiPromptLogSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      unique: true,
    },
    prompt: {
      type: String,
      required: true,
    },
    documentType: {
      type: String,
      enum: ["invoice", "purchase_order", "quotation", "expense"],
      required: true,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "processed", "confirmed", "failed", "cancelled"],
      default: "pending",
    },
    createdDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    createdDocumentType: {
      type: String,
      enum: ["Invoice", "PurchaseOrder", "Quotation", "Expense", null],
      default: null,
    },
    processingTimeMs: {
      type: Number,
      default: 0,
    },
    tokensUsed: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
    },
    errorMessage: {
      type: String,
      default: null,
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

aiPromptLogSchema.pre("save", async function (next) {
  if (!this.promptId) {
    try {
      const count = await this.constructor.countDocuments();
      this.promptId = `AI-${String(count + 1).padStart(6, "0")}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("AIPromptLog", aiPromptLogSchema);
