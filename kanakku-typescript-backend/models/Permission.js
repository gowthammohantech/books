const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
    roleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role', // References the Role model
        required: [true, 'Role ID is required']
    },
    moduleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module', // References the Module model
        default: null
    },
    create: {
        type: Boolean,
        default: false
    },
    edit: {
        type: Boolean,
        default: false
    },
    delete: {
        type: Boolean,
        default: false
    },
    view: {
        type: Boolean,
        default: false
    },
    allowAll: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true // adds createdAt and updatedAt fields automatically
});

module.exports = mongoose.model('Permission', permissionSchema);
