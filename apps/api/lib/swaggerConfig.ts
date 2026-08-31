import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Elixir Books API',
      version: '1.1.0',
      description: [
        'Elixir Books invoicing + accounting platform admin API.',
        '',
        '**Auth:** most endpoints require a Bearer JWT. Obtain one via `POST /auth/login`,',
        'then click **Authorize** and paste the token.',
        '',
        'Operations with a full request/response schema are hand-documented; the',
        'remainder are auto-listed from the live routes (method, path, path params,',
        'auth) so the reference is complete.',
      ].join('\n'),
      contact: { name: 'Elixir Books Support', email: 'support@example.com' },
    },
    servers: [
      { url: '/api', description: 'Current host' },
      { url: 'https://elixirbooks.example.com/api', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      responses: {
        Unauthorized: {
          description: 'Missing, invalid, or expired token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        ServerError: {
          description: 'Unexpected server error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Not authorized' },
            error: { type: 'string', nullable: true },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 137 },
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            totalPages: { type: 'integer', example: 14 },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth', description: 'Login + token handling' },
      { name: 'Dashboard', description: 'Dashboard summaries + accounts planning' },
      { name: 'Customers', description: 'Customer CRUD + statement + CSV import' },
      { name: 'Invoices', description: 'Invoices, recurring, templates, credit notes, public link' },
      { name: 'Quotations', description: 'Quotation CRUD + conversion' },
      { name: 'Products', description: 'Products, categories, brands, units' },
      { name: 'Inventory', description: 'Stock, cost layers (FIFO), valuation' },
      { name: 'Purchases', description: 'Suppliers, purchases, POs, debit notes, supplier payments' },
      { name: 'Payments', description: 'Payment transactions + gateway integrations' },
      { name: 'Expenses', description: 'Expenses, recurring expenses, categories, petty cash' },
      { name: 'Banking', description: 'Bank accounts + transactions + reconciliation' },
      { name: 'Accounting', description: 'Chart of accounts + journal entries + statements' },
      { name: 'Reports', description: 'P&L, balance sheet, aging, budgets, cash-flow' },
      { name: 'Tax & GST', description: 'Tax summary + GSTR-1 + GSTR-3B + filing exports' },
      { name: 'E-Invoice', description: 'India IRN generation' },
      { name: 'Integrations', description: 'Xero / QuickBooks / WhatsApp' },
      { name: 'AI', description: 'AI extraction + chat conversation' },
      { name: 'Users & Roles', description: 'Staff, roles, permissions' },
      { name: 'Audit', description: 'Activity log / audit trail' },
      { name: 'Reminders', description: 'Invoice / quotation reminders' },
      { name: 'Settings', description: 'Company settings, currencies, modules' },
      { name: 'Public', description: 'Unauthenticated public endpoints' },
    ],
  },
  apis: [
    './controllers/**/*.ts',
    './controllers/**/*.js',
    './routes/**/*.js',
    './routes/**/*.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
