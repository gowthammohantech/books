const mongoose = require('mongoose');

const customFieldDataTypeSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      enum: [
        'text', 
        'number', 
        'email', 
        'date', 
        'time', 
        'boolean', 
        'array', 
        'object', 
        'set', 
        'function',
        'textarea',
        'select',
        'checkbox',
        'radio',
        'currency',
        'Text Box (Single Line)',
        'Text Box (Multi Line)',
        'Number',
        'Email',
        'Date Picker',
        'Time',
        'Checkbox',
        'Radio Button',
        'Dropdown',
        'File Upload',
        'URL',
        'Phone Number',
        'Currency',
        'Percentage',
        'Decimal',
        'Integer',
        'Text Area',
        'Rich Text Editor',
        'Color Picker',
        'Range Slider',
        'Toggle Switch',
        'Rating',
        'Tags',
        'JSON Object',
        'Array List',
        'Set Collection',
        'Select and Option',
        'Function Call'
      ],
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
  }
);

// Index for better query performance
customFieldDataTypeSchema.index({ type: 1 });
customFieldDataTypeSchema.index({ isActive: 1 });
customFieldDataTypeSchema.index({ createdBy: 1 });

module.exports = mongoose.model('CustomFieldDataType', customFieldDataTypeSchema);
