const mongoose = require('mongoose');

const stateSchema = new mongoose.Schema({
  _id: Number,
  name: String,
  country_id: Number,
  state_code: String,
});

module.exports = mongoose.model('State', stateSchema);
