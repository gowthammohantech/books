const mongoose = require('mongoose');

const timeFormatSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  format: {
    type: String,
    required: true,
    unique: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Pre-save hook for any additional processing
timeFormatSchema.pre('save', function(next) {
  // You could add any pre-processing here if needed
  next();
});

// Add text index for searching
timeFormatSchema.index({ name: 'text', format: 'text' });

module.exports = mongoose.model('TimeFormat', timeFormatSchema);