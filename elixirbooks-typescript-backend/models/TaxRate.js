const mongoose = require('mongoose');

const taxRateSchema = new mongoose.Schema(
    {
        tax_name: {
            type: String,
            required: true,
            trim: true,
        },
        tax_rate: {
            type: Number,
            required: true,
        },
        status: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('TaxRate', taxRateSchema);
