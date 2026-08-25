const mongoose = require('mongoose');

const moduleSchema = new mongoose.Schema({
    moduleName: {
        type: String,
        required: [true, 'Module name is required'],
        trim: true,
        minlength: [2, 'Module name must be at least 2 characters'],
        maxlength: [255, 'Module name cannot exceed 255 characters']
    },
    moduleSlug: {
        type: String,
        required: [true, 'Module slug is required'],
        trim: true,
        minlength: [2, 'Module slug must be at least 2 characters'],
        maxlength: [255, 'Module slug cannot exceed 255 characters']
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module',
        default: null
    },
    userType: {
        type: Number,
        enum: [1, 2, 3], 
        required: [true, 'User type is required'],
        default: 1 // Admin
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Module', moduleSchema);
