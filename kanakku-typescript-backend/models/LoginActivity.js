const mongoose = require('mongoose');

const loginActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    ipAddress: {
      type: String,
      required: true
    },
    browser: {
      type: String,
      required: true
    },
    device: {
      type: String,
      required: true
    },
    location: {
      type: String,
      default: 'Unknown'
    },
    loginAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('LoginActivity', loginActivitySchema);
