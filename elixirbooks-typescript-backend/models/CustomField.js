const mongoose = require("mongoose");

const customFieldSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      required: true,
    },

    labelName: {
      type: String,
      required: [true, "Label name is required"],
      trim: true,
    },

    fieldSlug: {
      type: String,
      required: [true, "Field slug is required"],
      trim: true,
    },

    dataType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FieldType",
      required: true,
    },

    helpText: {
      type: String,
      default: "",
    },

    isMandatory: {
      type: Boolean,
      default: false,
    },

    showInTable: {
      type: Boolean,
      default: false,
    },

    options: [
      {
        label: String,
        value: String,
      },
    ],

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
  );


  // Prevent duplicate fieldSlug inside same module
  customFieldSchema.index(
    { moduleId: 1, fieldSlug: 1 },
    { unique: true, partialFilterExpression: { deletedAt: null } }
  );

  module.exports = mongoose.model("CustomField", customFieldSchema);
