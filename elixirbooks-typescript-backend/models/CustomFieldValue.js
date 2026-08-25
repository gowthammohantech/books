const mongoose = require("mongoose");

const customFieldValueSchema = new mongoose.Schema({
  
  customFieldId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CustomField",
    required: true
  },

  module: {
    type: String,
    required: true,
    enum: ["invoice","purchase","inventory","customer","supplier","expense","purchaseOrder"]
  },

  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },

  value: {
    type: mongoose.Schema.Types.Mixed
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }

},{
  timestamps:true
});

module.exports = mongoose.model("CustomFieldValue", customFieldValueSchema);