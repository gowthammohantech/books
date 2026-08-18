const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema({
  quotationId: {
    type: String,
    unique: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  quotationDate: {
    type: Date,
    required: true
  },
  expiryDate: {
    type: Date,
    required: false
  },
  referenceNo: {
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
      required: true
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
    enum: ['draft', 'sent', 'accepted', 'declined'],
    default: 'draft'
  },
  paymentTerms: {
    type: String,
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
  vat: {
    type: Number,
    default: 0
  },
  roundOff: {
    type: Boolean,
    default: false
  },
  TotalAmount: {
    type: Number,
    required: true
  },
  notes: String,
  termsAndCondition: String,
  sign_type: {
    type: String,
    enum: ['digitalSignature', 'eSignature', 'none'],
    default: 'none'
  },
  signatureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Signature'
  },
  signatureImage: String,
  signatureName: String,
  isDeleted: {
    type: Boolean,
    default: false
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  salesPerson: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  billFrom: {
    ref: 'User',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  billTo: {
    ref: 'Customer',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  bank: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankDetail',
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  convert_type: {
    type: String,
    enum: ['quotation', 'invoice', 'purchase'],
    default: 'quotation'
  }
}, {
  timestamps: true
});

// Pre-save hook to generate quotation ID
quotationSchema.pre('save', async function (next) {
  if (!this.quotationId) {
    try {
      const count = await this.constructor.countDocuments();
      this.quotationId = `QT-${String(count + 1).padStart(6, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

// Add validation based on sign_type
quotationSchema.pre('validate', function (next) {
  if (this.sign_type === 'eSignature' && !this.signatureImage) {
    this.invalidate('signatureImage', 'Signature image is required for eSignature');
  }
  if (this.sign_type === 'digitalSignature' && !this.signatureId) {
    this.invalidate('signatureId', 'Signature ID is required for digital signature');
  }

  // Clear unused signature fields
  if (this.sign_type === 'none') {
    this.signatureId = undefined;
    this.signatureImage = undefined;
    this.signatureName = undefined;
  } else if (this.sign_type === 'eSignature') {
    this.signatureId = undefined;
  } else if (this.sign_type === 'digitalSignature') {
    this.signatureImage = undefined;
    this.signatureName = undefined;
  }

  next();
});

module.exports = mongoose.model('Quotation', quotationSchema);