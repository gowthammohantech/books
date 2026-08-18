// models/DeliveryChallan.js
const mongoose = require("mongoose");

const deliveryChallanSchema = new mongoose.Schema(
  {
    challanNumber: {
      type: String,
      unique: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: false,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    challanDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    referenceNo: {
      type: String,
      default: "",
    },

    items: [
      {
        id: {
          type: String,      
          required: true
        },
        name: {
          type: String,
          required: true,
        },
        unit: {
          type: String,
          required: false,
        },
        qty: {
          type: Number,
          required: true,
        },
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
      enum: ["PENDING", "DELIVERED", "CANCELLED"],
      default: "DRAFT",
    },
    bank: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "BankDetail",
        },
    taxableAmount: {
      type: Number,
      required: true,
    },
    totalAmount: {
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
    notes: String,
    termsAndCondition: String,
    sign_type: {
      type: String,
      enum: ["none", "digitalSignature", "eSignature"],
      default: "none",
    },
    signatureName: {
      type: String,
      default: null,
    },
    signatureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Signature",
    },
    signatureImage: {
      type: String,
      default: null,
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
    receivedBy: {
      type: String,
      default: "",
    },
    receivedDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

deliveryChallanSchema.pre("save", async function (next) {
  if (!this.challanNumber) {
    try {
      const count = await this.constructor.countDocuments();
      this.challanNumber = `DC-${String(count + 1).padStart(6, "0")}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("DeliveryChallan", deliveryChallanSchema);
