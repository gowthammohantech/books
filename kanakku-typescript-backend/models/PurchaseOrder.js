const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
  purchaseOrderId: {
    type: String,
    unique: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  purchaseOrderDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
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
    enum: ['new', 'pending', 'completed', 'cancelled'],
    default: 'new'
  },
  paymentMode: {
    type: String,
    enum: ['CASH', 'CREDIT', 'CHECK', 'BANK_TRANSFER', 'OTHER'],
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
  bank: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankDetail',
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
  billFrom: {
    ref: 'User',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  billTo: {
    ref: 'User',
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  convert_type: {
    type: String,
    enum: ['purchase', 'estimate', 'invoice'],
    default: 'purchase'
  }
}, {
  timestamps: true
});

// Pre-save hook to generate purchase order ID
purchaseOrderSchema.pre('save', async function (next) {
  if (!this.purchaseOrderId) {
    try {
      const count = await this.constructor.countDocuments();
      this.purchaseOrderId = `PO-${String(count + 1).padStart(6, '0')}`;
      next();
    } catch (err) {
      next(err);
    }
  } else {
    next();
  }
});

// Add validation based on sign_type
purchaseOrderSchema.pre('validate', function (next) {
  if (this.sign_type === 'manualSignature' && !this.signatureImage) {
    this.invalidate('signatureImage', 'Signature image is required for manual signature');
  }
  if (this.sign_type === 'digitalSignature' && !this.signatureId) {
    this.invalidate('signatureId', 'Signature ID is required for digital signature');
  }

  // Clear unused signature fields
  if (this.sign_type === 'none') {
    this.signatureId = undefined;
    this.signatureImage = undefined;
    this.signatureName = undefined;
  } else if (this.sign_type === 'manualSignature') {
    this.signatureId = undefined;
  } else if (this.sign_type === 'digitalSignature') {
    this.signatureImage = undefined;
    this.signatureName = undefined;
  }

  next();
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);