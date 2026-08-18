const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    expenseId: {
      type: String,
      unique: true,
    },
    referenceNo: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      required: true,
    },
    expenseDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    paymentMode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentMode",
      required: function () {
        return this.sourceType === "BANK";
      },
    },
    paymentStatus: {
      type: String,
      enum: ["PAID", "CANCELLED", "PENDING"],
      default: "PENDING",
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    attachment: {
      type: String,
      default: null,
    },
    expenseCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      required: true,
    },
    sourceType: {
      type: String,
      enum: ["BANK", "PETTY_CASH"],
      required: true,
    },
    bankId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankDetail",
      required: function () {
        return this.sourceType === "BANK"; // ✅ Required only for BANK
      },
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// ✅ Auto-generate unique Expense ID
expenseSchema.pre("save", async function (next) {
  if (!this.expenseId) {
    try {
      const count = await this.constructor.countDocuments();
      this.expenseId = `EXP-${String(count + 1).padStart(6, "0")}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("Expense", expenseSchema);
