const mongoose = require("mongoose");

const fieldTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Field type name is required"],
      trim: true,
      maxlength: 100,
    },

    slug: {
      type: String,
      required: [true, "Slug is required"],
      trim: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("FieldType", fieldTypeSchema);
