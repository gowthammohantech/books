const mongoose = require('mongoose');

const bankDetailSchema = new mongoose.Schema({
    accountHoldername: {
        type: String,
        required: true,
        trim: true
    },
    bankName: {
        type: String,
        required: true,
        trim: true
    },
    branchName: {
        type: String,
        required: true,
        trim: true
    },
    accountNumber: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    IFSCCode: {
        type: String,
        required: true,
        trim: true
    },
    accountType: {
        type: String,
        enum: ['savings', 'current'],
        required: true
    },
    openingBalance: {
        type: mongoose.Types.Decimal128,
        default: 0
    },
    currentBalance: {
        type: mongoose.Types.Decimal128,
        default: 0
    },
    asOnDate: {
        type: Date,
        default: Date.now
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    status: {
        type: Boolean,
        default: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function(doc, ret) {
            delete ret.__v;
            delete ret.isDeleted;
            return ret;
        }
    },
    toObject: {
        virtuals: true,
        transform: function(doc, ret) {
            delete ret.__v;
            delete ret.isDeleted;
            return ret;
        }
    }
});

// Indexes
bankDetailSchema.index({ userId: 1 });
bankDetailSchema.index({ accountNumber: 1 }, { unique: true });
bankDetailSchema.index({ isDeleted: 1 });
bankDetailSchema.index({ status: 1 });

module.exports = mongoose.model('BankDetail', bankDetailSchema);