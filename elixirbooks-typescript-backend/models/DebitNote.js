const mongoose = require('mongoose');

const debitNoteSchema = new mongoose.Schema({
  debitNoteId: {
    type: String,
    unique: true
  },
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Purchase',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  debitNoteDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  dueDate: {
    type: Date,
    required: false
  },
  referenceNo: {
    type: String,
    default: ""
  },
  items: [{
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: false
    },
    name: {
      type: String,
      required: true
    },
    unit: {
      type: String,
      required: false
    },
    qty: {
      type: Number,
      required: false
    },
    rate: {
      type: Number,
      required: true
    },
    discount: {
      type: Number,
      default: 0
    },
    tax: {
      type: Number,
      default: 0
    },
    tax_group_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxGroup'
    },
    discount_type: {
      type: String,
      enum: ['Fixed', 'Percentage'],
      default: 'Fixed'
    },
    discount_value: {
      type: Number,
      default: 0
    },
    amount: {
      type: Number,
      required: true
    },
  }],
  status: {
    type: String,
    enum: ['new', 'pending', 'completed', 'cancelled', 'partially_paid', 'paid'],
    default: 'draft'
  },
  paymentMode: {
    type: String,
    ref: 'PaymentMode',
    required: false
  },
  taxableAmount: {
    type: Number,
    required: true
  },
  totalDiscount: {
    type: Number,
    default: 0
  },
  totalTax: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paidAmount: {
    type: Number,
    default: 0
  },
  balanceAmount: {
    type: Number,
    default: 0
  },
  bank: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankDetail',
  },
  notes: String,
  termsAndCondition: String,
  sign_type: {
    type: String,
    enum: ['none', 'digitalSignature', 'eSignature'],
    default: 'none'
  },
  signatureId: {
    type: String,
    default: null
  },
  signatureImage: {
    type: String,
    default: null
  },
  signatureName: {
    type: String,
    default: null
  },
  checkNumber: {
    type: String,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  billFrom: {
    ref: 'User',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  billTo: {
    ref: 'User',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }
}, {
  timestamps: true
});

// Pre-save hook to generate debit note ID
debitNoteSchema.pre('save', async function (next) {
  if (!this.debitNoteId) {
    try {
      const count = await this.constructor.countDocuments();
      this.debitNoteId = `DN-${String(count + 1).padStart(6, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model('DebitNote', debitNoteSchema);