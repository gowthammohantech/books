const mongoose = require('mongoose');

const generalSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      minlength: 2,
      maxlength: 100
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    groupSlug: {
      type: String,
      trim: true,
      default: 'general', // default group
      minlength: 2,
      maxlength: 100
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for faster query
generalSettingsSchema.index({ key: 1 });
generalSettingsSchema.index({ groupSlug: 1 });

module.exports = mongoose.model('GeneralSetting', generalSettingsSchema);
