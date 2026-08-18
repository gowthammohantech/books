// Timezone model in Mongoose (Node.js)
const mongoose = require('mongoose');

const timezoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  utc_offset: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

timezoneSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Timezone = mongoose.model('Timezone', timezoneSchema);
module.exports = Timezone;