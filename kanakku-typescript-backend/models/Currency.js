const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Currency name is required'],
        trim: true,
        minlength: [2, 'Currency name must be at least 2 characters'],
        maxlength: [50, 'Currency name cannot exceed 50 characters'],
    },
    code: {
        type: String,
        required: [true, 'Currency code is required'],
        trim: true,
        uppercase: true,
        minlength: [3, 'Currency code must be 3 characters'],
        maxlength: [3, 'Currency code must be 3 characters'],
    },
    symbol: {
        type: String,
        required: [true, 'Currency symbol is required'],
        trim: true,
        maxlength: [5, 'Currency symbol cannot exceed 5 characters']
    },
    status: {
        type: Boolean,
        default: true
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Created by user is required']
    }
}, {
    timestamps: true
});

// Ensure only one default currency exists
currencySchema.pre('save', async function(next) {
    if (this.isDefault) {
        await this.constructor.updateMany(
            { _id: { $ne: this._id }, isDefault: true },
            { $set: { isDefault: false } }
        );
    }
    next();
});


module.exports = mongoose.model('Currency', currencySchema);