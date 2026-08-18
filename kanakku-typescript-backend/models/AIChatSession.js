const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const aiChatSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      unique: true,
    },
    messages: [messageSchema],
    documentType: {
      type: String,
      enum: ["invoice", "purchase_order", "quotation", "expense", null],
      default: null,
    },
    currentExtractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "completed", "abandoned"],
      default: "active",
    },
    createdDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
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

aiChatSessionSchema.pre("save", async function (next) {
  if (!this.sessionId) {
    try {
      const count = await this.constructor.countDocuments();
      this.sessionId = `CHAT-${String(count + 1).padStart(6, "0")}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("AIChatSession", aiChatSessionSchema);
