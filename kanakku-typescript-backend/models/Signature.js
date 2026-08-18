const mongoose = require('mongoose');

const signatureSchema = new mongoose.Schema({
    signatureName: {
        type: String,
        required: [true, 'Signature name is required'],
        trim: true,
        minlength: [2, 'Signature name must be at least 2 characters'],
        maxlength: [50, 'Signature name cannot exceed 50 characters']
    },
    signatureImage: {
        type: String,
        required: [true, 'Signature image is required']
    },
    status: {
        type: Boolean,
        default: true
    },
    markAsDefault: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required']
    }
}, {
    timestamps: true
});

signatureSchema.pre('save', async function(next) {
    if (this.markAsDefault) {
        await this.constructor.updateMany(
            { userId: this.userId, markAsDefault: true },
            { $set: { markAsDefault: false } }
        );
    }
    next();
});

module.exports = mongoose.model('Signature', signatureSchema);