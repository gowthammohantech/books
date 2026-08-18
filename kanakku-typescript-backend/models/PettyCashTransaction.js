const mongoose = require('mongoose');

const pettyCashTransactionSchema = new mongoose.Schema({
    pettyCashId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PettyCash',
        required: true
    },
    transactionDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    transactionType: {
        type: String,
        enum: ['ADD', 'SPEND', 'RETURN'],
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
    remarks: {
        type: String,
        trim: true,
        default: null
    },
    relatedType: {
        type: String,
        enum: ['PETTY_CASH', 'SUPPLIER_PAYMENT', 'EXPENSE', 'BANK'],
        required: true
    },
    relatedId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
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

// Indexes for faster queries
pettyCashTransactionSchema.index({ pettyCashId: 1 });
pettyCashTransactionSchema.index({ transactionDate: -1 });
pettyCashTransactionSchema.index({ relatedType: 1, relatedId: 1 });
pettyCashTransactionSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('PettyCashTransaction', pettyCashTransactionSchema);
