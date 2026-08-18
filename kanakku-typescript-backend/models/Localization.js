const mongoose = require('mongoose');

const localizationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  dateFormat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DateFormat',
    required: true
  },
  timeFormat: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TimeFormat',
    required: true
  },
  timezone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Timezone',
    required: true
  },
  startWeek: {
    type: String,
    enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    default: 'Monday'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

localizationSchema.index({ user: 1, isActive: 1 }, { unique: true });

module.exports = mongoose.model('Localization', localizationSchema);