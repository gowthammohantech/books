const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        notification_type: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'NotificationType', // reference to NotificationType model
            required: true
        },
        description: {
            type: String,
            trim: true
        },
        subject: {
            type: String,
            required: true,
            trim: true
        },
        sms_content: {
            type: String,
            trim: true
        },
        notification_content: {
            type: String,
            trim: true
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        }
    },
    {
        timestamps: true // adds createdAt & updatedAt
    }
);

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
