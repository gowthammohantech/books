const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    invoiceDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    dueDate: {
      type: Date,
    },
    referenceNo: {
      type: String,
      default: "",
    },
    items: [
      {
        id: {
          type: String,
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        unit: String,
        qty: Number,
        rate: {
          type: Number,
          required: true,
        },
        discount: {
          type: Number,
          default: 0,
        },
        tax: {
          type: Number,
          default: 0,
        },
        tax_group_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "TaxGroup",
        },
        discount_type: {
          type: String,
          enum: ["Fixed", "Percentage"],
          default: "Fixed",
        },
        discount_value: {
          type: Number,
          default: 0,
        },
        amount: {
          type: Number,
          required: true,
        },
      },
    ],
    status: {
      type: String,
      enum: [
        "DRAFT",
        "UNPAID",
        "SENT",
        "PAID",
        "OVERDUE",
        "CANCELLED",
        "PARTIALLY_PAID",
      ],
      default: "DRAFT",
    },
    payment_method: String,
    taxableAmount: {
      type: Number,
      required: true,
    },
    TotalAmount: {
      type: Number,
      required: true,
    },
    vat: {
      type: Number,
      default: 0,
    },
    totalDiscount: {
      type: Number,
      default: 0,
    },
    roundOff: {
      type: Boolean,
      default: false,
    },
    bank: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BankDetail",
    },
    notes: String,
    termsAndCondition: String,
    isRecurring: {
      type: Boolean,
      default: false,
    },
    parentInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    repeatEvery: {
      type: String,
      enum: ["day", "week", "month", "year", "custom"],
      default: "month",
    },
    customIntervalNumber: {
      type: Number,
      default: null,
    },
    customIntervalType: {
      type: String,
      enum: ["day", "week", "month", "year"],
      default: null,
    },
    startOn: {
      type: Date,
      default: null,
    },
    endsOn: {
      type: Date,
      default: null,
    },
    neverExpire: {
      type: Boolean,
      default: false,
    },
    stopped: {
      type: Boolean,
      default: false,
    },
    lastRecurringDate: {
      type: Date,
      default: null,
    },
    nextRecurringDate: {
      type: Date,
      default: null,
    },
    sign_type: {
      type: String,
      enum: ["none", "digitalSignature", "eSignature"],
      default: "none",
    },
    signatureName: String,
    signatureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Signature",
    },
    signatureImage: String,
    isDeleted: {
      type: Boolean,
      default: false,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    billFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    billTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
  },
  { timestamps: true }
);

invoiceSchema.pre("save", async function (next) {
  try {
    if (!this.invoiceNumber) {
      const count = await this.constructor.countDocuments();
      this.invoiceNumber = `INV-${String(count + 1).padStart(6, "0")}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("Invoice", invoiceSchema);
