const mongoose = require('mongoose');

const expenseCategorySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String || null,
    trim: true
  },
  status: {
    type: Boolean,
    default: true // true = active, false = inactive
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);
