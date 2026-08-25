const mongoose = require('mongoose');

const paymentModeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      minlength: 3,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      minlength: 3,
      trim: true
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true } 
  }
);

module.exports = mongoose.model('PaymentMode', paymentModeSchema);