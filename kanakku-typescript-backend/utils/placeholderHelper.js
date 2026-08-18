// utils/placeholderHelper.js
const InvoicePayment = require('../models/InvoicePayment');

/**
 * Replace placeholders in email template with actual invoice data
 * @param {String} template - Email template with placeholders (e.g., "Hello %CustomerName%")
 * @param {Object} invoice - Invoice document with populated customer
 * @param {Object} user - User document
 * @returns {String} - Template with replaced placeholders
 */
const replacePlaceholders = async (template, invoice, user) => {
  if (!template || !invoice) {
    return template;
  }

  let result = template;

  // Calculate overdue days
  const overdueDays = invoice.dueDate 
    ? Math.max(0, Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24)))
    : 0;

  // Calculate balance (total amount - paid amount)
  const payments = await InvoicePayment.find({ invoiceId: invoice._id });
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = invoice.TotalAmount - totalPaid;

  // Get customer data (should be populated)
  const customer = invoice.customerId || invoice.billTo;
  const customerName = customer?.name || '';
  const customerEmail = customer?.email || '';

  // Get user who created the invoice
  const createdByUser = invoice.userId || invoice.billFrom;
  let createdByName = '';
  
  if (createdByUser) {
    if (typeof createdByUser === 'object') {
      // If populated as an object
      if (createdByUser.firstName && createdByUser.lastName) {
        createdByName = `${createdByUser.firstName} ${createdByUser.lastName}`;
      } else if (createdByUser.email) {
        createdByName = createdByUser.email;
      }
    } else {
      // If it's just an ObjectId, we can't get the name
      createdByName = '';
    }
  }

  // Generate invoice URL
  const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'http://localhost:3000';
  const invoiceUrl = `${baseUrl}/invoices/${invoice._id}`;
  const paymentLink = `${baseUrl}/pay/${invoice._id}`;

  // Format dates
  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Define placeholder replacements
  const replacements = {
    '%CustomerName%': customerName,
    '%CustomerEmail%': customerEmail,
    '%InvoiceNumber%': invoice.invoiceNumber || '',
    '%InvoiceDate%': formatDate(invoice.invoiceDate),
    '%DueDate%': formatDate(invoice.dueDate),
    '%OverdueDays%': overdueDays.toString(),
    '%Balance%': balance.toFixed(2),
    '%Total%': invoice.TotalAmount?.toFixed(2) || '0.00',
    '%Subject%': invoice.referenceNo || '',
    '%ReferenceNo%': invoice.referenceNo || '',
    '%Vat%': invoice.vat?.toFixed(2) || '0.00',
    '%TotalDiscount%': invoice.totalDiscount?.toFixed(2) || '0.00',
    '%TaxableAmount%': invoice.taxableAmount?.toFixed(2) || '0.00',
    '%PaymentMethod%': invoice.payment_method || '',
    '%Notes%': invoice.notes || '',
    '%TermsAndCondition%': invoice.termsAndCondition || '',
    '%CreatedBy%': createdByName,
    '%InvoiceUrl%': invoiceUrl,
    '%InvoicePaymentLink%': paymentLink
  };

  // Replace all placeholders
  Object.keys(replacements).forEach(placeholder => {
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, replacements[placeholder]);
  });

  return result;
};

/**
 * Replace placeholders in subject line
 * @param {String} subject - Email subject with placeholders
 * @param {Object} invoice - Invoice document
 * @returns {String} - Subject with replaced placeholders
 */
const replaceSubjectPlaceholders = async (subject, invoice) => {
  const customer = invoice.customerId || invoice.billTo;
  const customerName = customer?.name || '';

  // Calculate balance
  const payments = await InvoicePayment.find({ invoiceId: invoice._id });
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = invoice.TotalAmount - totalPaid;

  const replacements = {
    '%CustomerName%': customerName,
    '%InvoiceNumber%': invoice.invoiceNumber || '',
    '%Balance%': balance.toFixed(2)
  };

  let result = subject;
  Object.keys(replacements).forEach(placeholder => {
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    result = result.replace(regex, replacements[placeholder]);
  });

  return result;
};

module.exports = {
  replacePlaceholders,
  replaceSubjectPlaceholders
};

