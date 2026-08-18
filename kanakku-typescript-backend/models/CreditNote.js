const mongoose = require('mongoose');

const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: {
    type: String,
    unique: true
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  creditNoteDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  referenceNo: {
    type: String,
    default: ""
  },
  reason: {
    type: String,
    required: false,
    enum: ['RETURN', 'DAMAGED_GOODS', 'WRONG_ITEM', 'OVERCHARGE', 'CANCELLATION', 'OTHER'],
    default: 'OTHER'
  },
  description: {
    type: String,
    default: ""
  },
  items: [{
    id: {
      type: String,      
      required: true
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
    }
  }],
  status: {
    type: String,
    enum: ['PENDING', 'PAID', 'CANCELLED'],
    default: 'PENDING'
  },
  refund_method: {
    type: String,
    enum: ['CASH', 'BANK_TRANSFER', 'CREDIT_TO_ACCOUNT', 'NONE'],
    default: 'CREDIT_TO_ACCOUNT'
  },
  taxableAmount: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true
  },
  vat: {
    type: Number,
    default: 0
  },
  totalDiscount: {
    type: Number,
    default: 0
  },
  roundOff: {
    type: Boolean,
    default: false
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
  signatureName: {
    type: String,
    default: null
  },
  signatureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Signature'
  },
  signatureImage: {
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
  billFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  billTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  appliedToInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  appliedDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

creditNoteSchema.pre('save', async function (next) {
  if (!this.creditNoteNumber) {
    try {
      const count = await this.constructor.countDocuments();
      this.creditNoteNumber = `CN-${String(count + 1).padStart(6, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model('CreditNote', creditNoteSchema);