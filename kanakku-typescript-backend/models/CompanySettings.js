const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema({
    companyName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    address: {
        type: String,
        required: true,
        trim: true
    },
    city: {
        type: String,
        required: true
    },
    state: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    pincode: {
        type: String,
        required: true,
        trim: true
    },
    siteLogo: {
        type: String,
        default: ""
    },
    favicon: {
        type: String,
        default: ""
    },
    companyLogo: {
        type: String,
        default: ""
    },
    companyBanner: {
        type: String,
        default: ""
    },
    fax: {
        type: String,
        trim: true
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
            return ret;
        }
    }
});

companySettingsSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('CompanySettings', companySettingsSchema);