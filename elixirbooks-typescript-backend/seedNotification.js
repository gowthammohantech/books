// seeders/notificationSeeder.js
const mongoose = require('mongoose');
require('dotenv').config();

const NotificationTag = require('./models/NotificationTag'); // ✅ fix path
const NotificationType = require('./models/NotificationType'); // ✅ fix path

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Clear existing records (optional)
    await NotificationTag.deleteMany();
    await NotificationType.deleteMany();

    console.log('Existing Notification data cleared');

    // --- Create Tags ---
    const tags = await NotificationTag.insertMany([
      // Quotation
      { title: 'Quotation Number', status: 'active' },
      { title: 'Quotation Amount', status: 'active' },

      // Invoice
      { title: 'Invoice Date', status: 'active' },
      { title: 'Invoice Amount', status: 'active' },
      { title: 'Invoice Status', status: 'active' },

      // Purchase
      { title: 'Purchase Reference', status: 'active' },
      { title: 'Purchase Amount', status: 'active' },

      // Purchase Order
      { title: 'PO Number', status: 'active' },
      { title: 'PO Due Date', status: 'active' },
      { title: 'PO Amount', status: 'active' },
    ]);

    console.log('Notification Tags Created:', tags.map(t => t.title));

    // --- Map tag references ---
    const findTag = (title) => tags.find(t => t.title === title)._id;

    // --- Create Notification Types ---
    const types = await NotificationType.insertMany([
      {
        title: 'New Quotation Created',
        slug: 'new-quotation-created',
        tags: [findTag('Quotation Number'), findTag('Quotation Amount')],
        status: 'active',
      },
      {
        title: 'Quotation Approved',
        slug: 'quotation-approved',
        tags: [findTag('Quotation Number'), findTag('Quotation Amount')],
        status: 'active',
      },
      {
        title: 'Invoice Generated',
        slug: 'invoice-generated',
        tags: [
          findTag('Invoice Date'),
          findTag('Invoice Amount'),
          findTag('Invoice Status'),
        ],
        status: 'active',
      },
      {
        title: 'Invoice Payment Received',
        slug: 'invoice-payment-received',
        tags: [
          findTag('Invoice Date'),
          findTag('Invoice Amount'),
          findTag('Invoice Status'),
        ],
        status: 'active',
      },
      {
        title: 'Purchase Added',
        slug: 'purchase-added',
        tags: [findTag('Purchase Reference'), findTag('Purchase Amount')],
        status: 'active',
      },
      {
        title: 'Purchase Updated',
        slug: 'purchase-updated',
        tags: [findTag('Purchase Reference'), findTag('Purchase Amount')],
        status: 'active',
      },
      {
        title: 'Purchase Order Created',
        slug: 'purchase-order-created',
        tags: [
          findTag('PO Number'),
          findTag('PO Due Date'),
          findTag('PO Amount'),
        ],
        status: 'active',
      },
      {
        title: 'Purchase Order Approved',
        slug: 'purchase-order-approved',
        tags: [
          findTag('PO Number'),
          findTag('PO Due Date'),
          findTag('PO Amount'),
        ],
        status: 'active',
      },
    ]);

    console.log('✅ Notification Types Created:', types.map(t => t.title));

    console.log('🎉 Seeding Completed!');
    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Seeding Error:', error);
    mongoose.connection.close();
  }
};

seedData();
