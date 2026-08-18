const mongoose = require("mongoose");

const aiConfigurationSchema = new mongoose.Schema(
  {
    aiEnabled: {
      type: Boolean,
      default: true,
    },
    enabledModules: {
      invoice: { type: Boolean, default: true },
      purchase_order: { type: Boolean, default: true },
      quotation: { type: Boolean, default: true },
      expense: { type: Boolean, default: true },
    },
    defaultCurrency: {
      type: String,
      default: "INR",
    },
    defaultTaxType: {
      type: String,
      enum: ["GST", "CGST_SGST", "IGST", "VAT", "none"],
      default: "GST",
    },
    autoApplyTax: {
      type: Boolean,
      default: true,
    },
    defaultPaymentTermsDays: {
      type: Number,
      default: 15,
    },
    maxPromptsPerDay: {
      type: Number,
      default: 100,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AIConfiguration", aiConfigurationSchema);
