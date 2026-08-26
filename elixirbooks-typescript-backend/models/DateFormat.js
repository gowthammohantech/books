const mongoose = require('mongoose');

const dateFormatSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    unique: true
  },
  format: { // equivalent to `name` in SQL table
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

// Optional index for searching
dateFormatSchema.index({ title: 'text', format: 'text' });

module.exports = mongoose.model('DateFormat', dateFormatSchema);
