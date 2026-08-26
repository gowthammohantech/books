    // models/NotificationTag.js
    const mongoose = require('mongoose');

    const NotificationTagSchema = new mongoose.Schema({
        title: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        }
    }, {
        timestamps: true
    });

    module.exports = mongoose.model('NotificationTag', NotificationTagSchema);
