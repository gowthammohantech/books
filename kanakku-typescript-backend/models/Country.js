const mongoose = require('mongoose');

const countrySchema = new mongoose.Schema({
  _id: Number,
  name: String,
  iso3: String,
  iso2: String,
  phonecode: String,
  capital: String,
  currency: String,
  native: String,
  region: String,
  subregion: String,
});

module.exports = mongoose.model('Country', countrySchema, 'countries');
