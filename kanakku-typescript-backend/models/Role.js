const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
    roleName: {
        type: String,
        required: [true, 'Role name is required'],
        trim: true,
        minlength: [2, 'Role name must be at least 2 characters'],
        maxlength: [255, 'Role name cannot exceed 255 characters']
    },
    status: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: String,
        trim: true,
        default: null
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true 
});

module.exports = mongoose.model('Role', roleSchema);
