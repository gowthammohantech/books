const mongoose = require('mongoose');
const Module = require('./models/Module'); // Adjust path if needed

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/kanakku', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const seedModules = async () => {
  try {
    // Clear old records (optional, keep DB clean for re-run)
    await Module.deleteMany({});

    // Module hierarchy with parent and child relationships
    const moduleHierarchy = [
      {
        moduleName: 'Main',
        moduleSlug: 'main',
        children: [
          { moduleName: 'Dashboard', moduleSlug: 'dashboard' },
        ]
      },
      {
        moduleName: 'Inventory & Sales',
        moduleSlug: 'inventory-sales',
        children: [
          { moduleName: 'Product / Services', moduleSlug: 'product-services' },
          { moduleName: 'Inventory', moduleSlug: 'inventory' },
          { moduleName: 'Invoices', moduleSlug: 'invoices' },
          { moduleName: 'Credit Notes', moduleSlug: 'credit-notes' },
          { moduleName: 'Quotations', moduleSlug: 'quotations' },
          { moduleName: 'Delivery Challans', moduleSlug: 'delivery-challans' },
          { moduleName: 'Customers', moduleSlug: 'customers' },
        ]
      },
      {
        moduleName: 'Purchases',
        moduleSlug: 'purchases',
        children: [
          { moduleName: 'Purchases', moduleSlug: 'purchase-list' },
          { moduleName: 'Purchase Orders', moduleSlug: 'purchase-orders' },
          { moduleName: 'Debit Notes', moduleSlug: 'debit-notes' },
          { moduleName: 'Suppliers', moduleSlug: 'suppliers' },
          { moduleName: 'Supplier Payments', moduleSlug: 'supplier-payments' },
        ]
      },
      
      {
        moduleName: 'Manage Users',
        moduleSlug: 'manage-users',
        children: [
          { moduleName: 'Roles & Permissions', moduleSlug: 'roles-permissions' },
        ]
      },
       {
        moduleName: 'Finance & Accounting',
        moduleSlug: 'finance-accounting',
        children: [
          { moduleName: 'Expenses', moduleSlug: 'expenses' },
          { moduleName: 'Banking', moduleSlug: 'banking' },
          { moduleName: 'Transaction', moduleSlug: 'transaction' },
          { moduleName: 'Petty Cash ', moduleSlug: 'petty_cash ' },
        ]
      },
      {
        moduleName: 'Reports',
        moduleSlug: 'reports',
        children: [
          { moduleName: 'Item Reports', moduleSlug: 'item-reports' },
          { moduleName: 'Transaction Reports', moduleSlug: 'transaction-reports' },
          { moduleName: 'Finance Reports', moduleSlug: 'finance-reports' },
          { moduleName: 'Accounting Reports', moduleSlug: 'accounting-reports' },
        ]
      },
      {
        moduleName: 'Settings',
        moduleSlug: 'settings',
        children: [
          { moduleName: 'General Settings', moduleSlug: 'general-settings' },
          { moduleName: 'Website Settings', moduleSlug: 'website-settings' },
          { moduleName: 'System Settings', moduleSlug: 'system-settings' },
          { moduleName: 'Finance Settings', moduleSlug: 'finance-settings' },
          { moduleName: 'Other Settings', moduleSlug: 'other-settings' },
        ]
      },
    ];

    // Insert parent and child modules
    for (const moduleItem of moduleHierarchy) {
      const parent = await Module.create({
        moduleName: moduleItem.moduleName,
        moduleSlug: moduleItem.moduleSlug,
        userType: 1
      });

      if (moduleItem.children?.length) {
        const children = moduleItem.children.map(child => ({
          moduleName: child.moduleName,
          moduleSlug: child.moduleSlug,
          parentId: parent._id,
          userType: 1
        }));
        await Module.insertMany(children);
      }
    }

    console.log('Modules seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding modules:', error);
    process.exit(1);
  }
};

seedModules();
