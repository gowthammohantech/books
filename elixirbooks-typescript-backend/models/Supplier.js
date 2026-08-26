const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    supplier_name: {
        type: String,
        required: true,
        trim: true,
    },
    supplier_email: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    supplier_phone: {
        type: String,
        required: true,
        trim: true,
    },
    balance: {
        type: Number,
        default: 0
    },
    balance_type: {
        type: String,
        enum: ['credit', 'debit']
    },
    status: {
        type: Boolean,
        default: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
}, { timestamps: true });

module.exports = mongoose.model('Supplier', supplierSchema);