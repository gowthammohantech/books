const mongoose = require('mongoose');

const bankTransactionSchema = new mongoose.Schema({
  bankAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BankDetail',
    required: true
  },
  transactionDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'PAYMENT', 'RECEIPT'],
    required: true
  },
  amount: {
    type: mongoose.Types.Decimal128,
    required: true
  },
  balanceBefore: {
    type: mongoose.Types.Decimal128,
    required: true
  },
  balanceAfter: {
    type: mongoose.Types.Decimal128,
    required: true
  },
  paymentModeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentMode',
    required: true
  },
  referenceNo: {
    type: String,
    default: null,
    trim: true
  },
  remarks: {
    type: String,
    default: null,
    trim: true
  },
  relatedType: {
    type: String,
    enum: ['INVOICE_PAYMENT', 'SUPPLIER_PAYMENT', 'PETTYCASH', 'EXPENSE', 'MANUAL'],
    default: 'MANUAL'
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  isReconciled: {
    type: Boolean,
    default: false
  },
  reconciledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reconciliationDate: {
    type: Date,
    default: null
  },
  reconciliationNote: {
    type: String,
    default: null,
    trim: true
  },

  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function (doc, ret) {
      delete ret.__v;
      delete ret.isDeleted;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function (doc, ret) {
      delete ret.__v;
      delete ret.isDeleted;
      return ret;
    }
  }
});

bankTransactionSchema.index({ bankAccountId: 1 });
bankTransactionSchema.index({ transactionDate: -1 });
bankTransactionSchema.index({ relatedType: 1, relatedId: 1 });
bankTransactionSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('BankTransaction', bankTransactionSchema);
