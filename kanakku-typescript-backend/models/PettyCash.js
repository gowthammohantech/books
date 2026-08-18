const mongoose = require('mongoose');

const pettyCashSchema = new mongoose.Schema({
    openingBalance: {
        type: mongoose.Types.Decimal128,
        required: true,
        default: 0
    },
    currentBalance: {
        type: mongoose.Types.Decimal128,
        required: true,
        default: 0
    },
    asOnDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    isDeleted: {
        type: Boolean,
        default: false
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

// Ensure only one petty cash record exists (optional index)
pettyCashSchema.index({ _id: 1 }, { unique: true });

module.exports = mongoose.model('PettyCash', pettyCashSchema);
