const express = require('express');
const router = express.Router();
const reminderController = require('../controllers/reminderController');
const {
  createReminderValidator,
  updateReminderValidator,
  toggleReminderStatusValidator,
  sendManualReminderValidator,
  getRemindersByTypeValidator,
  getReminderByIdValidator,
  deleteReminderValidator
} = require('../validators/reminderValidator');
const protect = require('../middleware/authMiddleware');

// @route   GET /api/reminders
// @desc    Get all reminders with pagination and search
router.get('/get-reminders', protect, reminderController.getReminders);

// @route   GET /api/reminders/get-reminder-stats
// @desc    Get reminder statistics
router.get('/get-reminder-stats', protect, reminderController.getReminderStats);

// @route   GET /api/reminders/invoice-placeholders
// @desc    Get invoice placeholders for email templates
router.get('/invoice-placeholders', protect, reminderController.getInvoicePlaceholders);

// @route   GET /api/reminders/quotation-placeholders
// @desc    Get invoice placeholders for email templates
router.get('/quotation-placeholders', protect, reminderController.getQuotationPlaceholders);

// @route   POST /api/reminders/trigger-cron
// @desc    Manually trigger invoice reminder cron job (for testing)
router.post('/trigger-cron', protect, reminderController.triggerReminderCron);

// @route   GET /api/reminders/type/:type
// @desc    Get reminders by type (automatic or manual)
router.get('/type/:type', protect, getRemindersByTypeValidator, reminderController.getRemindersByType);

// @route   GET /api/reminders/:id
// @desc    Get a single reminder by ID
router.get('/:id', protect, getReminderByIdValidator, reminderController.getReminderById);

// @route   POST /api/reminders/create-reminder
// @desc    Create new reminder
router.post('/create-reminder', protect, createReminderValidator, reminderController.createReminder);

// @route   POST /api/reminders/create-reminder-quotation
// @desc    Create new reminder
router.post('/create-reminder-quotation', protect,  reminderController.createReminderQuotation);

// @route   PUT /api/reminders/update-reminder/:id
// @desc    Update reminder
router.put('/update-reminder/:id', protect, updateReminderValidator, reminderController.updateReminder);

// @route   PUT /api/reminders/update-reminder/:id
// @desc    Update reminder
router.put('/update-reminder-quotation/:id', protect, reminderController.updateReminderQuotation);

// @route   PATCH /api/reminders/:id/toggle
// @desc    Toggle reminder status (enable/disable)
router.patch('/:id/toggle', protect, toggleReminderStatusValidator, reminderController.toggleReminderStatus);

// @route   POST /api/reminders/:id/send
// @desc    Send manual reminder immediately
router.post('/:id/send', protect, sendManualReminderValidator, reminderController.sendManualReminder);

// @route   DELETE /api/reminders/:id
// @desc    Delete reminder (soft delete)
router.delete('/delete-reminder/:id', protect, deleteReminderValidator, reminderController.deleteReminder);

module.exports = router;
