// models/Conversation.js
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sessionId: {
        type: String,
        required: true,
        unique: true
    },
    documentType: {
        type: String,
        enum: ['invoice', 'quotation', 'expense', null],
        default: null
    },
    context: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            step: 'initial',
            extractedData: null,
            validationResults: null,
            missingFields: [],
            collectedData: {},
            pendingSelections: {
                type: 'none',
                options: [],
                selectedId: null,
                field: null
            },
            editMode: {
                active: false,
                documentId: null,
                documentType: null,
                originalData: null
            },
            lastPrompt: null,
            conversationHistory: []
        }
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'expired'],
        default: 'active'
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 60 * 1000) // 30 minutes expiry
    }
}, {
    timestamps: true
});

// Index for automatic cleanup
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Conversation', conversationSchema);