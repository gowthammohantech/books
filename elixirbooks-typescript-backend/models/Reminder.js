const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema(
  {
    // Basic reminder information
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Reminder name cannot exceed 100 characters']
    },

    // Reminder type: invoice, purchase, or quotation
    type: {
      type: String,
      required: true,
      enum: [
        'automatic',
        'manual',
        'automatic_Purchase',
        'manual_purchase',
        'automatic_quotation',
        'manual_quotation'
      ],
      default: 'automatic'
    },

    // Automatic reminder settings
    remindDays: {
      type: Number,
      required: function () {
        return (
          this.type === 'automatic' ||
          this.type === 'automatic_Purchase' ||
          this.type === 'automatic_quotation'
        );
      },
      min: [0, 'Remind days cannot be negative']
    },

    remindTiming: {
      type: String,
      required: function () {
        return (
          this.type === 'automatic' ||
          this.type === 'automatic_Purchase' ||
          this.type === 'automatic_quotation'
        );
      },
      enum: ['before', 'after', 'duedate'],
      default: 'after'
    },

    remindEvent: {
      type: String,
      required: function () {
        return (
          this.type === 'automatic' ||
          this.type === 'automatic_Purchase' ||
          this.type === 'automatic_quotation'
        );
      },
      enum: ['due_date', 'invoice_date', 'payment_date', 'quotation_date', 'expiry_date'],
      default: 'due_date'
    },

    // Enable/disable reminder
    isEnabled: {
      type: Boolean,
      default: true
    },

    // Email configuration
    emailConfig: {
      remindTo: { type: String, trim: true },
      fromEmail: {
        type: String,
        trim: true,
        validate: {
          validator: function (v) {
            if (!v) return true;
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
          },
          message: 'From email must be valid'
        }
      },
      cc: {
        type: [String],
        default: [],
        validate: {
          validator: v => v.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
          message: 'All CC emails must be valid'
        }
      },
      bcc: {
        type: [String],
        default: [],
        validate: {
          validator: v => v.every(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
          message: 'All BCC emails must be valid'
        }
      },
      subject: {
        type: String,
        required: true,
        trim: true,
        maxlength: [200, 'Subject cannot exceed 200 characters']
      },
      body: {
        type: String,
        required: true,
        trim: true
      }
    },

    // Invoice or Quotation target (for manual reminders)
    targetInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice'
    },

    targetQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quotation'
    },

    targetCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer'
    },

    // Manual reminder specific fields
    manualReminderData: {
      customSubject: { type: String, trim: true, maxlength: [200, 'Custom subject cannot exceed 200 characters'] },
      customBody: { type: String, trim: true },
      scheduledDate: { type: Date },
      status: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'cancelled'],
        default: 'pending'
      }
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanySettings', required: true },

    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active'
    },

    lastSent: { type: Date },
    nextSend: { type: Date }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
reminderSchema.index({ createdBy: 1, status: 1 });
reminderSchema.index({ type: 1, status: 1 });
reminderSchema.index({ companyId: 1, status: 1 });
reminderSchema.index({ nextSend: 1, isEnabled: 1 });
reminderSchema.index({ targetInvoice: 1 });
reminderSchema.index({ targetQuotation: 1 });
reminderSchema.index({ targetCustomer: 1 });

// Virtuals
reminderSchema.virtual('formattedTiming').get(function () {
  if (
    this.type === 'automatic' ||
    this.type === 'automatic_Purchase' ||
    this.type === 'automatic_quotation'
  ) {
    return `${this.remindDays} day(s) ${this.remindTiming} ${this.remindEvent}`;
  }
  return null;
});

reminderSchema.virtual('emailSummary').get(function () {
  return {
    from: this.emailConfig.fromEmail,
    cc: this.emailConfig.cc,
    bcc: this.emailConfig.bcc,
    subject: this.emailConfig.subject
  };
});

// Pre-save
reminderSchema.pre('save', function (next) {
  if (
    (this.type === 'automatic' ||
      this.type === 'automatic_Purchase' ||
      this.type === 'automatic_quotation') &&
    this.isEnabled &&
    this.isNew
  ) {
    this.nextSend = null; // Set dynamically later
  }
  next();
});

// Methods
reminderSchema.methods.shouldSend = function () {
  if (!this.isEnabled || this.status !== 'active') return false;

  if (
    this.type === 'manual' ||
    this.type === 'manual_purchase' ||
    this.type === 'manual_quotation'
  ) {
    return (
      this.manualReminderData.status === 'pending' &&
      new Date() >= this.manualReminderData.scheduledDate
    );
  }

  if (
    this.type === 'automatic' ||
    this.type === 'automatic_Purchase' ||
    this.type === 'automatic_quotation'
  ) {
    return this.nextSend && new Date() >= this.nextSend;
  }

  return false;
};

reminderSchema.methods.markAsSent = function () {
  this.lastSent = new Date();
  if (
    this.type === 'manual' ||
    this.type === 'manual_purchase' ||
    this.type === 'manual_quotation'
  ) {
    this.manualReminderData.status = 'sent';
  }
  return this.save();
};

module.exports = mongoose.model('Reminder', reminderSchema);
