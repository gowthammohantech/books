const mongoose = require('mongoose');

const unitSchema = new mongoose.Schema({
  unit_name: {
    type: String,
    required: true,
    trim: true
  },
  short_name: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: Boolean,
    default: true // true = active, false = inactive
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Unit', unitSchema);
