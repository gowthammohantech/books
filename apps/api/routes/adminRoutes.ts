// Admin API surface. Converted from adminRoutes.js: the require() calls it
// used — including 55 that went through the module-alias '@controllers'
// style — are now static imports, which is what lets the CommonJS interop
// tails come off the controllers.
import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as UnitsController from '../controllers/UnitsController';
import * as BrandsController from '../controllers/BrandsController';
import * as CategoryController from '../controllers/CategoryController';
import * as TaxRateController from '../controllers/TaxRateController';
import * as TaxGroupController from '../controllers/TaxGroupController';
import * as ProductController from '../controllers/ProductController';
import * as SupplierController from '../controllers/Admin/Purchases/SupplierController';
import * as purchaseOrderController from '../controllers/Admin/Purchases/purchaseOrderController';
import * as debitNoteController from '../controllers/Admin/Purchases/debitNoteController';
import * as purchaseController from '../controllers/Admin/Purchases/purchaseController';
import * as supplierPaymentController from '../controllers/Admin/Purchases/supplierPaymentController';
import * as supplierPaymentReadController from '../controllers/Admin/Purchases/supplierPaymentReadController';
import * as SignatureController from '../controllers/SignatureController';
import * as apiKeyController from '../controllers/apiKeyController';
import * as currencyController from '../controllers/currencyController';
import * as BankDetailController from '../controllers/bankDetailController';
import * as CompanySettings from '../controllers/CompanySettingsController';
import * as appVersionController from '../controllers/appVersionController';
import * as dashboardController from '../controllers/Admin/dashboardController';
import { uploadCompanyFields, handleUploadError } from '../middleware/uploadCompanyImages';
import protect from '../middleware/authMiddleware';
import { requirePermission, type PermCheck } from '../middleware/requirePermission';
import upload from '../middleware/upload';
import setup from '../middleware/setup';
import { uploadProductFields } from '../middleware/uploadProductImages';
import { createUnitValidator, updateUnitValidator } from '../validators/unitsValidator';
import { createBrandValidator, updateBrandValidator } from '../validators/brandValidator';
import { createCategoryValidator, updateCategoryValidator } from '../validators/categoryValidator';
import { createTaxRateValidator, updateTaxRateValidator } from '../validators/taxRateValidator';
import { createTaxGroupValidator, updateTaxGroupValidator } from '../validators/taxGroupValidator';
import { createProductValidator, updateProductValidator } from '../validators/productValidator';
import { updateProfileValidator } from '../validators/updateProfileValidator';
import { createSupplierValidator } from '../validators/Admin/Purchases/SupplierVaidator';
import { purchaseOrderValidator, updatePurchaseOrderValidator } from '../validators/Admin/Purchases/purchaseOrderValidator';
import { supplierPaymentValidator } from '../validators/Admin/Purchases/supplierPaymentValidator';
import { purchaseValidator } from '../validators/Admin/Purchases/purchaseValidator';
import { debitNoteValidator } from '../validators/Admin/Purchases/debitNoteValidator';
import { createSignatureValidator, updateSignatureValidator } from '../validators/signatureValidator';
import { createCurrencyValidator } from '../validators/currencyValidator';
import { createBankDetailValidator, updateBankDetailValidator, updateBankDetailStatusValidator } from '../validators/bankDetailValidator';
import { updateCompanySettingsValidator } from '../validators/companySettingsValidator';
import { createCustomerValidator } from '../validators/customerValidator';
import * as customerController from '../controllers/customerController';
import * as vehicleController from '../controllers/vehicleController';
import { createVehicleValidator, updateVehicleValidator } from '../validators/vehicleValidator';
import * as localizationController from '../controllers/localizationController';
import multer from 'multer';
import * as quotationController from '../controllers/Admin/Invoice/quotationController';
import { quotationValidator, updateQuotationValidator } from '../validators/Admin/Invoice/quotationValidator';
import * as invoiceTemplateController from '../controllers/invoiceTemplateController';
import { createInvoiceValidator } from '../validators/Admin/Invoice/invoiceValidator';
import { createCreditNoteValidator } from '../validators/Admin/Invoice/creditNoteValidator';
import { createDeliveryChallanValidator } from '../validators/Admin/Invoice/deliveryChallanValidator';
import * as invoiceController from '../controllers/Admin/Invoice/invoiceController';
import * as recurringScheduleController from '../controllers/recurringScheduleController';
import * as invoicePaymentController from '../controllers/Admin/Invoice/invoicePaymentController';
import * as creditNoteController from '../controllers/Admin/Invoice/creditNoteController';
import * as inventoryController from '../controllers/Admin/Invoice/inventoryController';
import * as deliveryChallanController from '../controllers/Admin/Invoice/deliveryChallanController';
import * as emailSettingsController from '../controllers/emailSettingsController';
import * as emailTeamplateController from '../controllers/emailTeamplateController';
import * as roleController from '../controllers/roleController';
import * as permissionController from '../controllers/permissionController';
import * as userController from '../controllers/userController';
import * as reportController from '../controllers/reportController';
import * as accountingReportController from '../controllers/accountingReportController';
import * as transactionReportController from '../controllers/transactionReportController';
import * as securityController from '../controllers/securityController';
import * as activityLogController from '../controllers/activityLogController';
import * as pettyCashController from '../controllers/pettyCashController';
import { createStaffValidator } from '../validators/staffValidator';
import { createRoleValidator } from '../validators/roleValidator';
import * as expenseController from '../controllers/expenseController';
import { createExpenseValidator } from '../validators/expenseValidator';
import * as expenseCategoryController from '../controllers/expenseCategoryController';
import { createCustomFieldValidator, updateCustomFieldValidator } from '../validators/customFieldValidator';
import { saveLocalizationValidator } from '../validators/localizationValidator';
import { createPettyCashValidator } from '../validators/pettyCashValidator';
import { handleValidationResult } from '../middleware/handleValidationResult';
import * as customFieldDataTypeController from '../controllers/customFieldDataTypeController';
import { createCustomFieldDataTypeValidator, updateCustomFieldDataTypeValidator } from '../validators/customFieldDataTypeValidator';
import * as fieldTypeController from '../controllers/fieldTypeController';
import * as customFieldController from '../controllers/customFieldController';
import * as aiController from '../controllers/Admin/AI/aiController';
import { processPromptValidator, confirmDocumentValidator, updateConfigValidator } from '../validators/Admin/AI/aiValidator';
import * as ledgerSetup from '../controllers/Admin/ledgerSetupController';
import * as ledgerCutover from '../controllers/Admin/ledgerCutoverController';
import * as gatewayConfigController from '../controllers/gatewayConfigController';
import * as paymentLinkMethodController from '../controllers/paymentLinkMethodController';
import * as paymentTransactionController from '../controllers/paymentTransactionController';
import * as refundController from '../controllers/refundController';
import * as razorpayController from '../controllers/razorpayController';
import * as stripeController from '../controllers/stripeController';
import * as accountController from '../controllers/accountController';
import * as journalEntryController from '../controllers/journalEntryController';
import * as financialStatementsController from '../controllers/financialStatementsController';
import * as taxReportsController from '../controllers/taxReportsController';
import * as accountingPeriodController from '../controllers/accountingPeriodController';
import * as gstFilingController from '../controllers/gstFilingController';
import * as eInvoiceController from '../controllers/eInvoiceController';
import * as whatsappController from '../controllers/whatsappController';
import * as accountingIntegrationController from '../controllers/accountingIntegrationController';
import * as aiConfigController from '../controllers/aiConfigController';
import * as aiExtractionController from '../controllers/aiExtractionController';
import * as aiChatController from '../controllers/aiChatController';
import * as aiUsageController from '../controllers/aiUsageController';
import uploadAiJobs from '../middleware/uploadAiJobs';
import { requireAiEnabled } from '../middleware/requireAiEnabled';
import { aiRateLimit } from '../middleware/aiRateLimit';
import * as agingController from '../controllers/agingController';
import * as supplierBalancesController from '../controllers/supplierBalancesController';
import * as budgetController from '../controllers/budgetController';
import * as fixedAssetController from '../controllers/fixedAssetController';
import * as documentDefaultsController from '../controllers/documentDefaultsController';
import * as reconciliationController from '../controllers/reconciliationController';
import * as staffActivityController from '../controllers/staffActivityController';
import * as moneyFlowController from '../controllers/moneyFlowController';
import * as transactionCategoryController from '../controllers/transactionCategoryController';
import { createTransactionCategoryValidator, updateTransactionCategoryValidator } from '../validators/transactionCategoryValidator';
import * as bankTransactionController from '../controllers/bankTransactionController';
import * as contactController from '../controllers/contactController';
import * as accountCreditController from '../controllers/accountCreditController';
import * as dashboardPlanningController from '../controllers/Admin/dashboardPlanningController';
import * as approvalsController from '../controllers/approvalsController';
import * as exchangeRateController from '../controllers/Admin/exchangeRateController';
import * as myMoneyController from '../controllers/myMoneyController';
import * as payrollController from '../controllers/payrollController';
import timeTrackingRoutes from './timeTrackingRoutes';
import exportRoutes from './exportRoutes';
import taxReturnRoutes from './taxReturnRoutes';
import mtdRoutes from './mtdRoutes';

const router = Router();

// Any document-creation module whose page needs shared reference data (tax
// groups, a "bill from" user picker, signatures) — gating those endpoints on
// a single unrelated module (e.g. Settings) forced admins to grant broad
// Settings access just so staff could use Invoices/Purchases/etc.
const DOCUMENT_MODULES = [
  'invoices', 'recurring-invoices', 'credit-notes', 'quotations', 'delivery-challans',
  'purchase-list', 'purchase-orders', 'debit-notes',
];






router.get('/', protect, requirePermission('dashboard', 'view'), adminController.dashboard);
router.get('/countries', protect, requirePermission('finance-settings', 'view'), adminController.getCountries);
router.get('/states/:countryId', protect, requirePermission('finance-settings', 'view'), adminController.getStates);
router.get('/cities/:stateId', protect, requirePermission('finance-settings', 'view'), adminController.getCities);
router.get('/country/:id', protect, requirePermission('finance-settings', 'view'), adminController.getCountryById);
router.get('/state/:id', protect, requirePermission('finance-settings', 'view'), adminController.getStateById);
router.get('/city/:id', protect, requirePermission('finance-settings', 'view'), adminController.getCityById);
router.get('/profile', protect, adminController.getProfile); /* self */
router.put('/profile', protect, upload.single('profileImage'), updateProfileValidator, adminController.updateProfile); /* self */

//Unit routes
router.get('/units', protect, requirePermission('product-services', 'view'), UnitsController.getUnits);
router.post('/units', protect, requirePermission('product-services', 'create'), upload.any(), createUnitValidator, UnitsController.createUnit);
router.get('/units/:id', protect, requirePermission('product-services', 'view'), UnitsController.getUnitById);
router.put('/units/:id', protect, requirePermission('product-services', 'edit'), upload.any(), updateUnitValidator, UnitsController.updateUnit);
router.delete('/units/:id', protect, requirePermission('product-services', 'delete'), UnitsController.deleteUnit);

//Brand routes
router.get('/brands', protect, requirePermission('product-services', 'view'), BrandsController.getAllBrands);
router.post('/brands', protect, requirePermission('product-services', 'create'), upload.any(), createBrandValidator, BrandsController.createBrand);
router.get('/brands/:id', protect, requirePermission('product-services', 'view'), BrandsController.getBrandById);
router.put('/brands/:id', protect, requirePermission('product-services', 'edit'), upload.any(), updateBrandValidator, BrandsController.updateBrand);
router.delete('/brands/:id', protect, requirePermission('product-services', 'delete'), BrandsController.deleteBrand);

//Category routes
router.get('/categories', protect, requirePermission('product-services', 'view'), CategoryController.getAllCategories);
router.post('/categories', protect, requirePermission('product-services', 'create'), upload.any(), createCategoryValidator, CategoryController.createCategory);
router.get('/categories/:id', protect, requirePermission('product-services', 'view'), CategoryController.getCategoryById);
router.put('/categories/:id', protect, requirePermission('product-services', 'edit'), upload.any(), updateCategoryValidator, CategoryController.updateCategory);
router.delete('/categories/:id', protect, requirePermission('product-services', 'delete'), CategoryController.deleteCategory);

// Tax Rate routes
router.get('/tax-rates', protect, requirePermission([...DOCUMENT_MODULES, 'finance-settings'], 'view'), TaxRateController.getAllTaxRates);
router.post('/tax-rates', protect, requirePermission('finance-settings', 'create'), createTaxRateValidator, TaxRateController.createTaxRate);
router.get('/tax-rates/:id', protect, requirePermission('finance-settings', 'view'), TaxRateController.getTaxRateById);
router.put('/tax-rates/:id', protect, requirePermission('finance-settings', 'edit'), updateTaxRateValidator, TaxRateController.updateTaxRate);
router.delete('/tax-rates/:id', protect, requirePermission('finance-settings', 'delete'), TaxRateController.deleteTaxRate);
// Read-only line-tax computations: settings roles keep their create-level gate;
// document roles (who can view/build documents) may compute line tax.
const TAX_COMPUTE_CHECKS: PermCheck[] = [
  { moduleSlug: 'finance-settings', action: 'create' },
  ...DOCUMENT_MODULES.map((m): PermCheck => ({ moduleSlug: m, action: 'view' })),
];
router.post('/tax-engine/suggest-for-line', protect, requirePermission(TAX_COMPUTE_CHECKS), TaxRateController.suggestForLine);
router.post('/tax-engine/resolve-line', protect, requirePermission(TAX_COMPUTE_CHECKS), TaxRateController.resolveLine);

//Tax Group routes
router.get('/tax-groups', protect, requirePermission('finance-settings', 'view'), TaxGroupController.getAllTaxGroups);
router.post('/tax-groups', protect, requirePermission('finance-settings', 'create'), createTaxGroupValidator, TaxGroupController.createTaxGroup);
router.get('/tax-groups/:id', protect, requirePermission('finance-settings', 'view'), TaxGroupController.getTaxGroupById);
router.put('/tax-groups/:id', protect, requirePermission('finance-settings', 'edit'), updateTaxGroupValidator, TaxGroupController.updateTaxGroup);
router.delete('/tax-groups/:id', protect, requirePermission('finance-settings', 'delete'), TaxGroupController.deleteTaxGroup);

//Product Routes
router.post('/products', protect, requirePermission('product-services', 'create'), uploadProductFields, handleUploadError, createProductValidator, ProductController.createProduct);
router.get('/products', protect, requirePermission('product-services', 'view'), ProductController.getAllProducts);
router.get('/products/:id', protect, requirePermission('product-services', 'view'), ProductController.getProductById);
router.put('/products/:id', protect, requirePermission('product-services', 'edit'), uploadProductFields, handleUploadError, updateProductValidator, ProductController.updateProduct);
router.delete('/products/:id', protect, requirePermission('product-services', 'delete'), ProductController.deleteProduct);
router.get('/product-categories', protect, requirePermission('product-services', 'view'), ProductController.getAllProductCategories);
router.get('/product-brands', protect, requirePermission('product-services', 'view'), ProductController.getAllProductBrands);
router.get('/product-units', protect, requirePermission('product-services', 'view'), ProductController.getAllUnits);
router.get('/product-taxes', protect, requirePermission('product-services', 'view'), ProductController.getAllTaxGroups);

//suppliers routes
router.post('/suppliers', protect, requirePermission('suppliers', 'create'), upload.single('profileImage'), createSupplierValidator, SupplierController.createSupplier);
router.get('/suppliers', protect, requirePermission(['suppliers', 'expenses'], 'view'), SupplierController.listSuppliers);
router.get('/suppliers/:id', protect, requirePermission('suppliers', 'view'), SupplierController.getSupplierById);
router.put('/suppliers/:id', protect, requirePermission('suppliers', 'edit'), upload.single('profileImage'), SupplierController.updateSupplier);
router.delete('/suppliers/:id', protect, requirePermission('suppliers', 'delete'), SupplierController.deleteSupplier);
//debitnote
router.post('/debitnote', protect, requirePermission('debit-notes', 'create'), upload.single('signatureImage'), debitNoteValidator, debitNoteController.createDebitNote);
router.get('/debitnote', protect, requirePermission('debit-notes', 'view'), debitNoteController.getAllDebitNotes);
router.put('/debitnote', protect, requirePermission('debit-notes', 'edit'), upload.single('signatureImage'), debitNoteController.createDebitNote);
router.get('/debitnote/:id', protect, requirePermission('debit-notes', 'view'), debitNoteController.getDebitNoteById);
router.delete('/debitnote/:id', protect, requirePermission('debit-notes', 'delete'), debitNoteController.deleteDebitNote);

//supplierpayment
router.post('/supplierpayments', protect, requirePermission('supplier-payments', 'create'), upload.single('attachment'), supplierPaymentValidator, supplierPaymentController.createSupplierPayment);
router.get('/supplierpayments', protect, requirePermission('supplier-payments', 'view'), supplierPaymentController.listSupplierPayments);
router.put('/supplierpayments/:id', protect, requirePermission('supplier-payments', 'edit'), upload.single('attachment'), supplierPaymentController.updateSupplierPayment);
router.delete('/supplierpayments/:id', protect, requirePermission('supplier-payments', 'delete'), supplierPaymentController.deleteSupplierPayment);

//purchase
router.post('/purchases', protect, requirePermission('purchase-list', 'create'), upload.single('signatureImage'), purchaseValidator, purchaseController.createPurchase);
router.put('/purchases/:id', protect, requirePermission('purchase-list', 'edit'), upload.single('signatureImage'), purchaseController.updatePurchase);
router.get('/purchases', protect, requirePermission('purchase-list', 'view'), purchaseController.getAllPurchases);
router.get('/purchases/:id', protect, requirePermission(['purchase-list', 'debit-notes'], 'view'), purchaseController.getPurchaseById);
router.delete('/purchases/:id', protect, requirePermission('purchase-list', 'delete'), purchaseController.deletePurchase);
router.get('/purchases-minimal', protect, requirePermission(['purchase-list', 'banking', 'debit-notes'], 'view'), purchaseController.listPurchasesMinimal);
router.get('/purchases-pending', protect, requirePermission('purchase-list', 'view'), purchaseController.listPurchasesPending);
router.post('/purchase-order-convert', protect, requirePermission('purchase-list', 'create'), purchaseController.createPurchaseFromPO);
router.get('/purchases/:id/payments', protect, requirePermission('purchase-list', 'view'), supplierPaymentReadController.listSupplierPaymentsForPurchase);
router.get('/purchases/:id/activity', protect, requirePermission('purchase-list', 'view'), supplierPaymentReadController.purchaseActivity);
router.post('/purchases/payments/:paymentId/void', protect, requirePermission('purchase-list', 'edit'), supplierPaymentReadController.voidSupplierPayment);
router.post('/purchases/mail', protect, requirePermission('purchase-list', 'edit'), purchaseController.sendPurchaseEmail);

//purchaseOrder
router.post('/purchase-order', protect, requirePermission('purchase-orders', 'create'), upload.single('signatureImage'), purchaseOrderValidator, purchaseOrderController.createPurchaseOrder);
router.get('/purchase-orders', protect, requirePermission('purchase-orders', 'view'), purchaseOrderController.listPurchaseOrders);
router.get('/purchase-orders/:id', protect, requirePermission('purchase-orders', 'view'), purchaseOrderController.getPurchaseOrderById);
router.put('/purchase-orders/:id', protect, requirePermission('purchase-orders', 'edit'), upload.single('signatureImage'), updatePurchaseOrderValidator, purchaseOrderController.updatePurchaseOrder);
router.delete('/purchase-orders/:id', protect, requirePermission('purchase-orders', 'delete'), purchaseOrderController.deletePurchaseOrder);
router.get('/purchase-minimal', protect, requirePermission('purchase-orders', 'view'), purchaseOrderController.listPurchaseOrdersMinimal);

// Helper routes for purchase order creation
router.get('/user/type/:type', protect, requirePermission([...DOCUMENT_MODULES, 'expenses', 'banking', 'my-money'], 'view'), purchaseOrderController.listUsersByType);
router.get('/user/:id', protect, requirePermission(DOCUMENT_MODULES, 'view'), purchaseOrderController.getUserById);
router.get('/productsrecent', protect, requirePermission([...DOCUMENT_MODULES, 'product-services'], 'view'), purchaseOrderController.getRecentProductsWithSearch);
router.get('/bankdetailsrecent', protect, requirePermission([...DOCUMENT_MODULES, 'banking', 'expenses'], 'view'), purchaseOrderController.listBankDetails);
router.get('/signaturesrecent', protect, requirePermission([...DOCUMENT_MODULES, 'general-settings'], 'view'), purchaseOrderController.getUserSignatures);
router.get('/tax-group-details', protect, requirePermission([...DOCUMENT_MODULES, 'finance-settings'], 'view'), purchaseOrderController.getAllTaxGroupsDetails);
//signature
router.post('/signatures', protect, requirePermission('general-settings', 'create'), upload.single('signatureImage'), createSignatureValidator, SignatureController.createSignature);
router.get('/signatures', protect, requirePermission('general-settings', 'view'), SignatureController.getUserSignatures);
router.put('/signatures/:signatureId', protect, requirePermission('general-settings', 'edit'), upload.single('signatureImage'), updateSignatureValidator, SignatureController.updateSignature);
router.delete('/signatures/:signatureId', protect, requirePermission('general-settings', 'delete'), SignatureController.deleteSignature);
router.patch('/signatures/set-default/:signatureId', protect, requirePermission('general-settings', 'edit'), SignatureController.setAsDefaultSignature);
router.patch('/signatures/status/:signatureId', protect, requirePermission('general-settings', 'edit'), SignatureController.updateSignatureStatus);
// Per-workspace API keys for the server-to-server integration (P5). Gated on
// general-settings because minting one grants write access to this workspace's
// data — the same weight as changing company settings.
router.get('/api-keys', protect, requirePermission('general-settings', 'view'), apiKeyController.listApiKeys);
router.post('/api-keys', protect, requirePermission('general-settings', 'create'), apiKeyController.createApiKey);
router.delete('/api-keys/:id', protect, requirePermission('general-settings', 'delete'), apiKeyController.revokeApiKey);

router.post('/paymentmode', protect, requirePermission('banking', 'create'), SignatureController.createPaymentMode);
router.get('/paymentmode', protect, requirePermission([...DOCUMENT_MODULES, 'banking', 'expenses'], 'view'), SignatureController.listPaymentModes);

//currency
router.post('/currency', protect, requirePermission('finance-settings', 'create'), createCurrencyValidator, currencyController.createCurrency);
router.get('/currency', protect, requirePermission([...DOCUMENT_MODULES, 'finance-settings'], 'view'), currencyController.getAllCurrencies);
router.put('/currency/:id', protect, requirePermission('finance-settings', 'edit'), currencyController.updateCurrency);
router.delete('/currency/:id', protect, requirePermission('finance-settings', 'delete'), currencyController.deleteCurrency);
router.patch('/currency/:id', protect, requirePermission('finance-settings', 'edit'), currencyController.updateCurrencyStatus);

//bankDetails
router.post('/bank-accounts', protect, requirePermission('banking', 'create'), createBankDetailValidator, BankDetailController.createBankDetail);
router.get('/bank-accounts', protect, requirePermission('banking', 'view'), BankDetailController.listBankDetails);
router.put('/bank-accounts/:id', protect, requirePermission('banking', 'edit'), updateBankDetailValidator, BankDetailController.updateBankDetail);
router.delete('/bank-accounts/:id', protect, requirePermission('banking', 'delete'), BankDetailController.deleteBankDetail);
router.patch('/bank-accounts/restore/:id', protect, requirePermission('banking', 'edit'), BankDetailController.restoreBankDetail);
router.patch('/bank-accounts/status/:id', protect, requirePermission('banking', 'edit'), updateBankDetailStatusValidator, BankDetailController.updateBankDetailStatus);
router.post('/bank-reconcile/:id', protect, requirePermission('banking', 'create'), BankDetailController.reconcileTransaction);
router.get('/bank-petty', protect, requirePermission('banking', 'view'), BankDetailController.listFinancialDetails);
router.get('/bank-transactions-reconcile', protect, requirePermission('banking', 'view'), BankDetailController.listBankTransactionsReconciled);
router.get('/bank-transactions-details/:id', protect, requirePermission('banking', 'view'), BankDetailController.getBankTransactionDetails);

// Money flow — transaction type registry
router.get('/transaction-types', protect, requirePermission('banking', 'view'), moneyFlowController.getTransactionTypes);

// Transaction categories (Task 5) — CRUD
router.get('/transaction-categories', protect, requirePermission('banking', 'view'), transactionCategoryController.list);
router.post('/transaction-categories', protect, requirePermission('banking', 'create'), createTransactionCategoryValidator, transactionCategoryController.create);
router.put('/transaction-categories/:id', protect, requirePermission('banking', 'edit'), updateTransactionCategoryValidator, transactionCategoryController.update);
router.patch('/transaction-categories/:id/status', protect, requirePermission('banking', 'edit'), transactionCategoryController.updateStatus);
router.delete('/transaction-categories/:id', protect, requirePermission('banking', 'delete'), transactionCategoryController.remove);

// Bank transactions (slice E.1) — list/get/create/delete + CSV import
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.get('/bank-transactions', protect, requirePermission('banking', 'view'), bankTransactionController.list);
router.get('/bank-transactions/:id', protect, requirePermission('banking', 'view'), bankTransactionController.getById);
router.post('/bank-transactions', protect, requirePermission('banking', 'create'), bankTransactionController.create);
router.delete('/bank-transactions/:id', protect, requirePermission('banking', 'delete'), bankTransactionController.remove);
router.post('/bank-transactions/import', protect, requirePermission('banking', 'create'), csvUpload.single('file'), bankTransactionController.importPreview);
router.post('/bank-transactions/import/confirm', protect, requirePermission('banking', 'create'), bankTransactionController.importConfirm);

// Bank transactions (slice E.2) — reconciliation matcher + link/unlink
router.get('/bank-transactions/:id/suggest-matches', protect, requirePermission('banking', 'view'), bankTransactionController.suggestMatches);
router.post('/bank-transactions/:id/link', protect, requirePermission('banking', 'create'), bankTransactionController.link);
router.post('/bank-transactions/:id/unlink', protect, requirePermission('banking', 'create'), bankTransactionController.unlink);

// Bank transactions (Task 3) — auto-analyse into the FOR_APPROVAL queue
// (analyse-all is a literal path; declare it before the :id variant)
router.post('/bank-transactions/analyse-all', protect, requirePermission('banking', 'create'), bankTransactionController.analyseAll);
router.post('/bank-transactions/:id/analyse', protect, requirePermission('banking', 'create'), bankTransactionController.analyse);

// Bank transactions (Task 4) — one-click approve / reject of FOR_APPROVAL queue
router.post('/bank-transactions/:id/approve', protect, requirePermission('banking', 'create'), bankTransactionController.approveBankTransaction);
router.post('/bank-transactions/:id/reject', protect, requirePermission('banking', 'create'), bankTransactionController.rejectBankTransaction);

// Bank transactions (Task 7) — explain / unexplain (Money In/Out)
router.post('/bank-transactions/:id/explain', protect, requirePermission('banking', 'create'), moneyFlowController.explain);
router.post('/bank-transactions/:id/unexplain', protect, requirePermission('banking', 'create'), moneyFlowController.unexplainTxn);


//company
router.put('/company-details/:tenantId', protect, requirePermission('website-settings', 'edit'), uploadCompanyFields, handleUploadError, updateCompanySettingsValidator, CompanySettings.updateCompanySettings);
// Read-only: also used by the invoice/purchase "Bill From" picker to load a
// company's currency/address — widen so staff creating documents don't need
// Settings view access just to populate that dropdown. Only the PUT above
// (actually editing company settings) stays Settings-gated.
router.get('/company-details/:tenantId', protect, requirePermission([...DOCUMENT_MODULES, 'website-settings'], 'view'), CompanySettings.getCompanySettings);
router.get('/system-settings', protect, CompanySettings.getBasicDetails); /* self */
router.patch('/company/setup', protect, requirePermission('website-settings', 'edit'), setup.single('siteLogo'), CompanySettings.updateCompanySetup);
// Also powers per-document numbering config (e.g. the invoice/quotation
// number-format modal) — additionally allow anyone who can edit a document
// type through, so staff don't need Settings access just to configure their
// own document numbering. Purely additive: the original general-settings
// 'create' check still passes on its own, unchanged.
router.post('/create-general-settings', protect, requirePermission([
  { moduleSlug: 'general-settings', action: 'create' },
  ...DOCUMENT_MODULES.map((slug): PermCheck => ({ moduleSlug: slug, action: 'edit' })),
]), CompanySettings.createOrUpdateGeneralSetting);
router.get('/general-settings-list', protect, requirePermission([...DOCUMENT_MODULES, 'general-settings'], 'view'), CompanySettings.listGeneralSettings);

// Document defaults (slice D.1)
router.get('/document-defaults', protect, requirePermission('general-settings', 'view'), documentDefaultsController.getDocumentDefaults);
router.put('/document-defaults', protect, requirePermission('general-settings', 'edit'), documentDefaultsController.updateDocumentDefaults);

//customer
/**
 * @swagger
 * /admin/customers:
 *   post:
 *     tags: [Customers]
 *     summary: Create a new customer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               image: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Customer created
 */
router.post('/customers', protect, requirePermission('customers', 'create'), upload.single('image'), createCustomerValidator, customerController.createCustomer);
router.put('/customers/:id', protect, requirePermission('customers', 'edit'), upload.single('image'), customerController.updateCustomer);

/**
 * @swagger
 * /admin/customers:
 *   get:
 *     tags: [Customers]
 *     summary: List customers (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of customers with pagination
 */
router.get('/customers', protect, requirePermission('customers', 'view'), customerController.getCustomers);
router.get('/customers/:id', protect, requirePermission('customers', 'view'), customerController.getCustomerById);
router.delete('/customers/:id', protect, requirePermission('customers', 'delete'), customerController.deleteCustomer);
router.post('/customers/minimal', protect, requirePermission('customers', 'create'), customerController.createMinimalCustomer);
router.get('/customers/:id/statement', protect, requirePermission('customers', 'view'), customerController.getStatement);
// Customer CSV import (slice E.4)
router.post('/customers/import', protect, requirePermission('customers', 'create'), csvUpload.single('file'), customerController.customerImportPreview);
router.post('/customers/import/confirm', protect, requirePermission('customers', 'create'), customerController.customerImportConfirm);

// Unified Contacts (Stage B — Task 2 CRUD + Task 3 analytics + Task 9 import/export)
router.get('/contacts', protect, requirePermission(['contacts', 'customers', ...DOCUMENT_MODULES], 'view'), contactController.listContacts);
router.post('/contacts', protect, requirePermission(['contacts', 'customers'], 'create'), contactController.createContact);
// Static sub-paths must be declared before /:id to avoid route shadowing
router.post('/contacts/minimal', protect, requirePermission(['contacts', 'customers', ...DOCUMENT_MODULES], 'create'), contactController.createMinimalContact);
router.post('/contacts/import', protect, requirePermission(['contacts', 'customers'], 'create'), csvUpload.single('file'), contactController.contactImportPreview);
router.post('/contacts/import/confirm', protect, requirePermission(['contacts', 'customers'], 'create'), contactController.contactImportConfirm);
router.get('/contacts/export', protect, requirePermission(['contacts', 'customers'], 'view'), contactController.getContactsExport);
router.get('/contacts/:id', protect, requirePermission(['contacts', 'customers', ...DOCUMENT_MODULES], 'view'), contactController.getContact);
router.get('/contacts/:id/summary', protect, requirePermission(['contacts', 'customers'], 'view'), contactController.getContactSummary);
router.get('/contacts/:id/statement', protect, requirePermission(['contacts', 'customers'], 'view'), contactController.getContactStatement);
router.get('/contacts/:id/history', protect, requirePermission(['contacts', 'customers'], 'view'), contactController.getContactHistory);
router.get('/contacts/:id/vcard', protect, requirePermission(['contacts', 'customers'], 'view'), contactController.getContactVCard);
router.put('/contacts/:id', protect, requirePermission(['contacts', 'customers'], 'edit'), contactController.updateContact);
router.delete('/contacts/:id', protect, requirePermission(['contacts', 'customers'], 'delete'), contactController.deleteContact);

// Account Credit — per-contact goodwill/promo credit (grant/void; redemption owned elsewhere)
router.post('/contacts/:id/credits', protect, requirePermission(['contacts', 'customers'], 'edit'), accountCreditController.grantAccountCredit);
router.delete('/contacts/:id/credits/:entryId', protect, requirePermission(['contacts', 'customers'], 'edit'), accountCreditController.voidAccountCredit);

// Vehicles
router.get('/vehicles', protect, requirePermission('vehicles', 'view'), vehicleController.getAllVehicles);
router.get('/customers/:customerId/vehicles', protect, requirePermission('vehicles', 'view'), vehicleController.getVehiclesForCustomer);
router.get('/vehicles/:id', protect, requirePermission('vehicles', 'view'), vehicleController.getVehicleById);
router.post('/vehicles', protect, requirePermission('vehicles', 'create'), createVehicleValidator, vehicleController.createVehicle);
router.put('/vehicles/:id', protect, requirePermission('vehicles', 'edit'), updateVehicleValidator, vehicleController.updateVehicle);
router.delete('/vehicles/:id', protect, requirePermission('vehicles', 'delete'), vehicleController.deleteVehicle);

// Payment infrastructure (slice D.1)
router.get('/gateway-configs', protect, requirePermission('finance-settings', 'view'), gatewayConfigController.list);
router.get('/gateway-configs/:kind', protect, requirePermission('finance-settings', 'view'), gatewayConfigController.get);
router.put('/gateway-configs/:kind', protect, requirePermission('finance-settings', 'edit'), gatewayConfigController.upsert);
router.delete('/gateway-configs/:kind', protect, requirePermission('finance-settings', 'delete'), gatewayConfigController.remove);

// Link-based payment methods (Wise, Revolut, ... — public "Pay with" buttons)
router.get('/payment-link-methods', protect, requirePermission('finance-settings', 'view'), paymentLinkMethodController.list);
router.post('/payment-link-methods', protect, requirePermission('finance-settings', 'create'), paymentLinkMethodController.create);
router.put('/payment-link-methods/:id', protect, requirePermission('finance-settings', 'edit'), paymentLinkMethodController.update);
router.delete('/payment-link-methods/:id', protect, requirePermission('finance-settings', 'delete'), paymentLinkMethodController.remove);

router.get('/payment-transactions', protect, requirePermission('payment-transactions', 'view'), paymentTransactionController.list);
router.get('/payment-transactions/:id', protect, requirePermission('payment-transactions', 'view'), paymentTransactionController.getById);

router.get('/refunds', protect, requirePermission('finance-settings', 'view'), refundController.list);
router.get('/refunds/:id', protect, requirePermission('finance-settings', 'view'), refundController.getById);

// Razorpay (slice D.2)
router.post('/razorpay/create-order/:invoiceId', protect, requirePermission('finance-settings', 'create'), razorpayController.createOrder);
router.post('/razorpay/verify', protect, requirePermission('finance-settings', 'create'), razorpayController.verifyPayment);
router.post('/razorpay/refund/:paymentTransactionId', protect, requirePermission('finance-settings', 'create'), razorpayController.refund);

// Stripe (slice D.3)
router.post('/stripe/create-checkout-session/:invoiceId', protect, requirePermission('finance-settings', 'create'), stripeController.createCheckoutSession);
router.post('/stripe/refund/:paymentTransactionId', protect, requirePermission('finance-settings', 'create'), stripeController.refund);

//localization
router.get('/localization', protect, requirePermission('general-settings', 'view'), localizationController.getDropdownOptions);
router.post('/localizations', protect, requirePermission('general-settings', 'create'), saveLocalizationValidator, localizationController.saveLocalization);
router.get('/localizations', protect, requirePermission('general-settings', 'view'), localizationController.getLocalization);
router.get('/settings-dropdown', protect, localizationController.getSettingsDropdownList); /* self */

//Quotation
router.post('/quotations', protect, requirePermission('quotations', 'create'), upload.single('signatureImage'), quotationValidator, quotationController.createQuotation);
router.get('/quotations', protect, requirePermission('quotations', 'view'), quotationController.listQuotations);
router.get('/quotations/:id', protect, requirePermission('quotations', 'view'), quotationController.getQuotationById);
router.put('/quotations/:id', protect, requirePermission('quotations', 'edit'), upload.single('signatureImage'), updateQuotationValidator, quotationController.updateQuotation);
router.delete('/quotations/:id', protect, requirePermission('quotations', 'delete'), quotationController.deleteQuotation);
router.get('/quotations', protect, requirePermission('quotations', 'view'), quotationController.listQuotations);
router.get('/customers-all', protect, requirePermission('customers', 'view'), quotationController.getAllCustomers);
router.get('/quotations-minimal', protect, requirePermission('quotations', 'view'), quotationController.getAllCustomers);
router.patch('/quotations-status/:id', protect, requirePermission('quotations', 'edit'), quotationController.updateQuotationStatus);
router.post('/quotations/mail', protect, requirePermission('quotations', 'edit'), quotationController.sendQuotationEmailAndUpdateStatus);
router.post('/quotations/:id/enable-public-link', protect, requirePermission('quotations', 'edit'), quotationController.enableQuotationPublicLink);

//invoicetemplate
router.post('/invoice-template', protect, requirePermission('general-settings', 'create'), invoiceTemplateController.createOrUpdateTemplate);
router.get('/invoice-templates', protect, requirePermission('general-settings', 'view'), invoiceTemplateController.getAllTemplates);
//Invoice
/**
 * @swagger
 * /admin/invoices:
 *   post:
 *     tags: [Invoices]
 *     summary: Create a new invoice
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               customerId: { type: string }
 *               billTo: { type: string }
 *               items: { type: string, description: "JSON-encoded array of line items" }
 *               TotalAmount: { type: number }
 *     responses:
 *       201:
 *         description: Invoice created
 */
router.post('/invoices', protect, requirePermission('invoices', 'create'), upload.single('signatureImage'), createInvoiceValidator, invoiceController.createInvoice);
router.post('/invoices/mail', protect, requirePermission('invoices', 'edit'), invoiceController.sendInvoiceEmail);
router.post('/invoices/update-status', protect, requirePermission('invoices', 'edit'), invoiceController.updateInvoiceStatus);
router.post('/invoices/:id/mark-sent', protect, requirePermission('invoices', 'edit'), invoiceController.markInvoiceSent);
router.get('/invoices/next-number', protect, requirePermission('invoices', 'view'), invoiceController.getNextInvoiceNumber);

/**
 * @swagger
 * /admin/invoices:
 *   get:
 *     tags: [Invoices]
 *     summary: List invoices (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of invoices with pagination
 */
router.get('/invoices', protect, requirePermission('invoices', 'view'), invoiceController.getAllInvoices);
router.get('/invoices/:id', protect, requirePermission(['invoices', 'credit-notes', 'delivery-challans'], 'view'), invoiceController.getInvoice);
router.get('/invoices/details/:id', protect, requirePermission('invoices', 'view'), invoiceController.getInvoice);
router.put('/invoices/:id', protect, requirePermission('invoices', 'edit'), upload.single('signatureImage'), invoiceController.updateInvoice);
router.delete('/invoices/:id', protect, requirePermission('invoices', 'delete'), invoiceController.deleteInvoice);
router.post('/quotation-convert-to-invoice/:quotationId', protect, requirePermission('invoices', 'edit'), upload.single('signatureImage'), invoiceController.convertQuotationToInvoice);
router.post('/invoices/:id/convert-to-invoice', protect, requirePermission('invoices', 'edit'), invoiceController.convertProformaToInvoice);
router.post('/invoice/payment', protect, requirePermission('invoices', 'create'), invoiceController.recordInvoicePayment);
router.post('/invoices-minimal', protect, requirePermission(['invoices', 'banking', 'credit-notes', 'delivery-challans'], 'view'), invoiceController.listInvoicesMinimal);
router.get('/invoice-payment-details/:id', protect, requirePermission('invoices', 'view'), invoiceController.getInvoicePaymentDetails);
router.get('/invoices/:id/payments', protect, requirePermission('invoices', 'view'), invoicePaymentController.listInvoicePayments);
router.get('/invoices/:id/activity', protect, requirePermission('invoices', 'view'), invoicePaymentController.invoiceActivity);
router.post('/invoices/payments/:paymentId/void', protect, requirePermission('invoices', 'edit'), invoicePaymentController.voidInvoicePayment);
router.get('/invoices-recurring', protect, requirePermission('recurring-invoices', 'view'), invoiceController.getChildInvoices);
router.post('/invoices-minimal-delivery', protect, requirePermission(['invoices', 'delivery-challans'], 'view'), invoiceController.listInvoicesMinimalWithoutChallan);

// Legacy recurring-invoice routes (slice B.3) RETIRED: the isRecurring-on-Invoice
// path is fully superseded by RecurringInvoiceSchedule below. Controller functions
// (getRecurringInvoices/getInvoiceChildren/runRecurringNow/setRecurringStatus)
// remain defined but are no longer registered as HTTP routes.

// Recurring invoice SCHEDULES (rebuild Task 3) — non-posting templates + lifecycle.
// A schedule NEVER posts to the GL or adjusts inventory; only the generated
// child invoices do (via the runner, Task 4).
router.post('/recurring-schedules', protect, requirePermission('recurring-invoices', 'create'), recurringScheduleController.createSchedule);
router.get('/recurring-schedules', protect, requirePermission('recurring-invoices', 'view'), recurringScheduleController.listSchedules);
router.get('/recurring-schedules/:id', protect, requirePermission('recurring-invoices', 'view'), recurringScheduleController.getSchedule);
router.put('/recurring-schedules/:id', protect, requirePermission('recurring-invoices', 'edit'), recurringScheduleController.updateSchedule);
router.post('/recurring-schedules/:id/pause', protect, requirePermission('recurring-invoices', 'edit'), recurringScheduleController.pauseSchedule);
router.post('/recurring-schedules/:id/resume', protect, requirePermission('recurring-invoices', 'edit'), recurringScheduleController.resumeSchedule);
router.post('/recurring-schedules/:id/end', protect, requirePermission('recurring-invoices', 'edit'), recurringScheduleController.endSchedule);
router.post('/recurring-schedules/:id/run-now', protect, requirePermission('recurring-invoices', 'create'), recurringScheduleController.runScheduleNow);
router.get('/recurring-schedules/:id/occurrences', protect, requirePermission('recurring-invoices', 'view'), recurringScheduleController.listOccurrences);

// Public link management (slice B.4)
router.post('/invoices/:id/enable-public-link', protect, requirePermission('invoices', 'edit'), invoiceController.enablePublicLink);
router.post('/invoices/:id/disable-public-link', protect, requirePermission('invoices', 'edit'), invoiceController.disablePublicLink);
router.post('/invoices/:id/rotate-public-link', protect, requirePermission('invoices', 'edit'), invoiceController.rotatePublicLink);


//Email Settings
router.post("/email-settings", protect, requirePermission('general-settings', 'create'), emailSettingsController.createOrUpdateEmailSettings);
router.get("/email-settings", protect, requirePermission('general-settings', 'view'), emailSettingsController.getEmailSettings);
router.post("/email-settings/test", protect, requirePermission('general-settings', 'create'), emailSettingsController.sendTestEmail);

//Email Template
router.post("/email-template", protect, requirePermission('general-settings', 'create'), emailTeamplateController.createEmailTemplate);
router.get("/email-template", protect, requirePermission('general-settings', 'view'), emailTeamplateController.listEmailTemplates);
router.get("/email-template/resolve/:docType/:id", protect, requirePermission('general-settings', 'view'), emailTeamplateController.resolveDocumentTemplate);
router.put("/email-template/:id", protect, requirePermission('general-settings', 'edit'), emailTeamplateController.updateEmailTemplate);
router.delete("/email-template/:id", protect, requirePermission('general-settings', 'delete'), emailTeamplateController.deleteEmailTemplate);
router.get("/notification-types", protect, requirePermission('general-settings', 'view'), emailTeamplateController.listNotificationTypes);


//credit notes
router.post('/credit-notes', protect, requirePermission('credit-notes', 'create'), upload.single('signatureImage'), createCreditNoteValidator, creditNoteController.createCreditNote);
router.get('/credit-notes', protect, requirePermission(['credit-notes', 'banking'], 'view'), creditNoteController.getAllCreditNotes);
router.get('/credit-notes/:id', protect, requirePermission('credit-notes', 'view'), creditNoteController.getCreditNoteById);
router.put('/credit-notes/:id', protect, requirePermission('credit-notes', 'edit'), upload.single('signatureImage'), creditNoteController.updateCreditNote);
router.delete('/credit-notes/:id', protect, requirePermission('credit-notes', 'delete'), creditNoteController.deleteCreditNote);

//delivery challan
router.post('/delivery-challan', protect, requirePermission('delivery-challans', 'create'), upload.single('signatureImage'), createDeliveryChallanValidator, deliveryChallanController.createDeliveryChallan);
router.get('/delivery-challan', protect, requirePermission('delivery-challans', 'view'), deliveryChallanController.getDeliveryChallans);
router.get('/delivery-challan/:id', protect, requirePermission('delivery-challans', 'view'), deliveryChallanController.getDeliveryChallanById);
router.put('/delivery-challan/:id', protect, requirePermission('delivery-challans', 'edit'), upload.single('signatureImage'), deliveryChallanController.updateDeliveryChallan);
router.delete('/delivery-challan/:id', protect, requirePermission('delivery-challans', 'delete'), deliveryChallanController.deleteDeliveryChallan);

//inventory
router.get('/inventory', protect, requirePermission('inventory', 'view'), inventoryController.listInventory);
router.get('/inventory/history/:id', protect, requirePermission('inventory', 'view'), inventoryController.getInventoryHistory);
router.post('/inventory', protect, requirePermission('inventory', 'create'), inventoryController.updateStock);

//staff
router.post('/staff', protect, requirePermission('roles-permissions', 'create'), upload.single('profileImage'), createStaffValidator, userController.createStaffUser);
router.put('/staff/:id', protect, requirePermission('roles-permissions', 'edit'), upload.single('profileImage'), userController.updateStaffUser);
router.get('/staff', protect, requirePermission(['roles-permissions', 'payroll', 'time-tracking', 'time-tracking-others'], 'view'), userController.listStaffUsers);
router.delete('/staff/:id', protect, requirePermission('roles-permissions', 'delete'), userController.deleteStaffUser);

//roles
router.get('/roles', protect, requirePermission('roles-permissions', 'view'), roleController.getRoles);
router.get('/roles-minimal', protect, requirePermission('roles-permissions', 'view'), roleController.getAllRoles);
router.post('/roles', protect, requirePermission('roles-permissions', 'create'), createRoleValidator, roleController.createRole);
router.put('/roles/:id', protect, requirePermission('roles-permissions', 'edit'), roleController.updateRole);
router.delete('/roles/:id', protect, requirePermission('roles-permissions', 'delete'), roleController.deleteRole);
router.get('/user-by-role/:roleId', protect, requirePermission([...DOCUMENT_MODULES, 'roles-permissions'], 'view'), roleController.listUsersByRole);


//permission
router.get('/permissions/:roleId', protect, requirePermission('roles-permissions', 'view'), permissionController.getPermissionsByRole);
router.get('/module-hierarchy', protect, requirePermission([...DOCUMENT_MODULES, 'roles-permissions'], 'view'), permissionController.getModuleHierarchy);
router.post('/permissions', protect, requirePermission('roles-permissions', 'edit'), permissionController.createOrUpdatePermissions);

//report
router.get('/inventory/stock-summary', protect, requirePermission('item-reports', 'view'), reportController.getInventoryStockSummary);
router.get('/report/inventory', protect, requirePermission('item-reports', 'view'), reportController.getInventoryReport);
router.get('/report/best-seller', protect, requirePermission('item-reports', 'view'), reportController.getBestSellerReport);
router.get('/report/low-stock', protect, requirePermission('item-reports', 'view'), reportController.getLowStockReport);
router.get('/report/stock-history', protect, requirePermission('item-reports', 'view'), reportController.getStockHistoryReport);
router.get('/report/out-of-stock', protect, requirePermission('item-reports', 'view'), reportController.getOutStockReport);

//accounting report
router.get('/report/income', protect, requirePermission('accounting-reports', 'view'), accountingReportController.getIncomeStats);
router.get('/report/expense', protect, requirePermission('accounting-reports', 'view'), accountingReportController.getPurchaseReport);
router.get('/report/payment-summary', protect, requirePermission('accounting-reports', 'view'), accountingReportController.getPaymentSummaryReport);

//transaction report 
router.get('/report/sales', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getInvoiceSalesReport);
router.get('/report/sales-return', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getCreditNoteSalesReport);
router.get('/report/purchase', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getPurchaseReport);
router.get('/report/purchase-order', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getPurchaseOrderReport);
router.get('/report/debit-note', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getDebitNoteReport);
router.get('/report/quotation', protect, requirePermission('transaction-reports', 'view'), transactionReportController.getQuotationSalesReport);

//security Settings
router.put('/security/reset-password/:tenantId', protect, requirePermission('roles-permissions', 'edit'), securityController.resetPassword);
router.delete('/security/delete-account/:tenantId', protect, requirePermission('roles-permissions', 'delete'), securityController.deleteAccount);
router.get('/security/login-activities/:tenantId', protect, requirePermission('roles-permissions', 'view'), securityController.getLoginActivitiesByUser);

//activity log (audit trail)
router.get('/activity-logs', protect, requirePermission('activity-log', 'view'), activityLogController.listActivityLogs);

//dashboard
router.get('/dashboard', protect, requirePermission('dashboard', 'view'), dashboardController.getDashboard);
router.get('/dashboard/accounts-planning', protect, requirePermission('dashboard', 'view'), dashboardPlanningController.accountsPlanning);
router.get('/work-queues', protect, requirePermission('dashboard', 'view'), dashboardController.getWorkQueues);

//expense
router.post("/expenses", protect, requirePermission('expenses', 'create'), upload.single("attachment"), createExpenseValidator, expenseController.createExpense);
router.get("/expenses", protect, requirePermission('expenses', 'view'), expenseController.getAllExpenses);
router.get("/expenses/:id", protect, requirePermission('expenses', 'view'), expenseController.getExpenseById);
router.put("/expenses/:id", protect, requirePermission('expenses', 'edit'), upload.single("attachment"), expenseController.updateExpense);
router.delete("/expenses/:id", protect, requirePermission('expenses', 'delete'), expenseController.deleteExpense);

// Recurring expenses (slice C.2)
router.get('/recurring-expenses', protect, requirePermission('recurring-expenses', 'view'), expenseController.getRecurringExpenses);
router.get('/expenses/:id/children', protect, requirePermission('recurring-expenses', 'view'), expenseController.getExpenseChildren);
router.post('/expenses/:id/run-recurring-now', protect, requirePermission('recurring-expenses', 'edit'), expenseController.runRecurringExpenseNow);
router.patch('/expenses/:id/recurring-status', protect, requirePermission('recurring-expenses', 'edit'), expenseController.setExpenseRecurringStatus);

//expenseCategory
router.post("/expense-category", protect, requirePermission('expenses', 'create'), expenseCategoryController.createExpenseCategory);
router.get("/expense-category", protect, requirePermission('expenses', 'view'), expenseCategoryController.getAllExpenseCategories);
router.get("/expense-category/:id", protect, requirePermission('expenses', 'view'), expenseCategoryController.getExpenseCategoryById);
router.put('/expense-category/:id', protect, requirePermission('expenses', 'edit'), expenseCategoryController.updateExpenseCategory);
router.delete('/expense-category/:id', protect, requirePermission('expenses', 'delete'), expenseCategoryController.deleteExpenseCategory);
router.get("/expense-category-minimal", protect, requirePermission('expenses', 'view'), expenseCategoryController.listExpenseCategories);

//pettyCash
router.post("/petty-cash", protect, requirePermission('petty-cash', 'create'), createPettyCashValidator, pettyCashController.createPettyCash);
router.get("/petty-cash", protect, requirePermission('petty-cash', 'view'), pettyCashController.listPettyCash);
router.get("/bank-petty-chart", protect, requirePermission('petty-cash', 'view'), pettyCashController.getFinancialSummary);
router.put("/petty-cash", protect, requirePermission('petty-cash', 'edit'), pettyCashController.returnPettyCash);
router.get("/petty-cash-transaction", protect, requirePermission('petty-cash', 'view'), pettyCashController.listPettyCashTransactions);

//app-version
router.get("/app-version", appVersionController.getAppVersionStatus); /* self */


//custom-field-data-types
router.post('/custom-field-data-types', protect, requirePermission('module-settings', 'create'), createCustomFieldDataTypeValidator, customFieldDataTypeController.createCustomFieldDataType);
router.get('/custom-field-data-types', protect, requirePermission('module-settings', 'view'), customFieldDataTypeController.getAllCustomFieldDataTypes);


// Field Types
router.post('/field-types', protect, requirePermission('module-settings', 'create'), fieldTypeController.createFieldType);
router.get('/field-types', protect, requirePermission([...DOCUMENT_MODULES, 'module-settings'], 'view'), fieldTypeController.getFieldTypes);


// Custom Fields
router.post('/custom-fields', protect, requirePermission('module-settings', 'create'), createCustomFieldValidator, handleValidationResult, customFieldController.createCustomField);
router.put('/custom-fields/:id', protect, requirePermission('module-settings', 'edit'), updateCustomFieldValidator, handleValidationResult, customFieldController.updateCustomField);
router.get('/custom-fields', protect, requirePermission('module-settings', 'view'), customFieldController.getCustomFields);
router.get('/custom-fields/module/:moduleId', protect, requirePermission([...DOCUMENT_MODULES, 'module-settings'], 'view'), customFieldController.getModuleFields);
router.get('/customfields/module/:moduleId', protect, requirePermission('module-settings', 'view'), customFieldController.getModuleFieldsNew);
router.delete('/custom-fields/:id', protect, requirePermission('module-settings', 'delete'), customFieldController.deleteCustomField);

// AI Routes - Core
router.post('/ai/process', protect, requirePermission('ai', 'create'), processPromptValidator, aiController.processAIPrompt);
router.post('/ai/confirm', protect, requirePermission('ai', 'create'), confirmDocumentValidator, aiController.confirmAIDocument);
router.get('/ai/history', protect, requirePermission('ai', 'view'), aiController.getAIHistory);
router.get('/ai/history/:id', protect, requirePermission('ai', 'view'), aiController.getAIPromptDetail);
router.delete('/ai/history/:id', protect, requirePermission('ai', 'delete'), aiController.deleteAIPromptLog);
// NOTE (cluster H, slice H.1): the legacy AIConfiguration endpoints below
// were a stub for a different (module-toggles) feature and collide with
// the new BYOK AiConfig endpoints registered further down. Commented out
// here; the new owner is `aiConfigController` at the bottom of this file.
// router.get('/ai/config', protect, aiController.getAIConfig);
// router.put('/ai/config', protect, updateConfigValidator, aiController.updateAIConfig);
router.get('/ai/stats', protect, requirePermission('ai', 'view'), aiController.getAIStats);

// AI Routes - Suggestions
router.get('/ai/suggestions', protect, requirePermission('ai', 'view'), aiController.getSuggestions);

// AI Routes - Batch Processing
router.post('/ai/batch', protect, requirePermission('ai', 'create'), aiController.processBatch);

// AI Routes - Insights
router.get('/ai/insights', protect, requirePermission('ai', 'view'), aiController.getInsights);

// AI Routes - Chat Conversational Mode
// NOTE (cluster H, slice H.3): the legacy conversational-mode chat endpoints
// below belong to an abandoned AI feature and collide path-for-path with the
// new BYOK streaming co-pilot (`aiChatController`) mounted near the bottom of
// this file (`/ai/chat`, `/ai/chat/sessions/*`). Critically, the legacy
// `GET /ai/chat/:sessionId` would shadow the new `GET /ai/chat/sessions/:id`
// since Express matches in order. Commented out here; the new owner is
// `aiChatController`. The legacy controller file is left in place but unmounted.
// router.post('/ai/chat/start', protect, aiController.startChatSession);
// router.post('/ai/chat/:sessionId/message', protect, aiController.sendChatMessage);
// router.get('/ai/chat/:sessionId', protect, aiController.getChatSession);
// router.get('/ai/chat', protect, aiController.listChatSessions);

// AI Routes - Duplicate Detection
router.post('/ai/check-duplicates', protect, requirePermission('ai', 'create'), aiController.checkDuplicates);

// AI Routes - Payment Follow-up
router.get('/ai/overdue-invoices', protect, requirePermission('ai', 'view'), aiController.getOverdueInvoices);
router.post('/ai/generate-followup', protect, requirePermission('ai', 'create'), aiController.generateFollowup);
router.post('/ai/send-followup', protect, requirePermission('ai', 'create'), aiController.sendFollowup);

// AI Routes - Prompt Templates
router.post('/ai/templates', protect, requirePermission('ai', 'create'), aiController.createTemplate);
router.get('/ai/templates', protect, requirePermission('ai', 'view'), aiController.getTemplates);
router.put('/ai/templates/:id', protect, requirePermission('ai', 'edit'), aiController.updateTemplate);
router.delete('/ai/templates/:id', protect, requirePermission('ai', 'delete'), aiController.deleteTemplate);
router.post('/ai/templates/:id/use', protect, requirePermission('ai', 'create'), aiController.useTemplate);

// Chart of Accounts (slice F.1)
router.get('/accounts', protect, requirePermission('chart-of-accounts', 'view'), accountController.list);
router.post('/accounts/seed-defaults', protect, requirePermission('chart-of-accounts', 'create'), accountController.seedDefaults);
router.get('/accounts/:id', protect, requirePermission('chart-of-accounts', 'view'), accountController.getById);
router.post('/accounts', protect, requirePermission('chart-of-accounts', 'create'), accountController.create);
router.put('/accounts/:id', protect, requirePermission('chart-of-accounts', 'edit'), accountController.update);
router.delete('/accounts/:id', protect, requirePermission('chart-of-accounts', 'delete'), accountController.remove);

router.get('/journal-entries', protect, requirePermission('journal-entries', 'view'), journalEntryController.list);
router.get('/journal-entries/:id', protect, requirePermission('journal-entries', 'view'), journalEntryController.getById);
router.post('/journal-entries', protect, requirePermission('journal-entries', 'create'), journalEntryController.create);
router.delete('/journal-entries/:id', protect, requirePermission('journal-entries', 'delete'), journalEntryController.remove);

// Financial statements (slice F.2)
/**
 * @swagger
 * /admin/reports/profit-loss:
 *   get:
 *     tags: [Accounting]
 *     summary: Profit & Loss statement
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: P&L with revenue, expense, net income
 */
router.get('/reports/profit-loss', protect, requirePermission('accounting-reports', 'view'), financialStatementsController.profitLoss);
router.get('/reports/balance-sheet', protect, requirePermission('accounting-reports', 'view'), financialStatementsController.balanceSheet);
router.get('/reports/trial-balance', protect, requirePermission('accounting-reports', 'view'), financialStatementsController.trialBalance);

// Tax reports (slice F.3)
router.get('/reports/tax-summary', protect, requirePermission('accounting-reports', 'view'), taxReportsController.taxSummary);
/**
 * @swagger
 * /admin/reports/gstr-1:
 *   get:
 *     tags: [Tax & GST]
 *     summary: GSTR-1 summary for a tax period
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer, minimum: 1, maximum: 12 }
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: GSTR-1 summary
 */
router.get('/reports/gstr-1', protect, requirePermission('accounting-reports', 'view'), taxReportsController.gstr1);
router.get('/reports/gstr-3b', protect, requirePermission('accounting-reports', 'view'), taxReportsController.gstr3b);

// Accounting periods (slice F.4)
router.get('/accounting-periods', protect, requirePermission('accounting', 'view'), accountingPeriodController.list);
router.post('/accounting-periods', protect, requirePermission('accounting', 'create'), accountingPeriodController.create);
router.put('/accounting-periods/:id', protect, requirePermission('accounting', 'edit'), accountingPeriodController.update);
router.post('/accounting-periods/:id/lock', protect, requirePermission('accounting', 'edit'), accountingPeriodController.lock);
router.post('/accounting-periods/:id/unlock', protect, requirePermission('accounting', 'edit'), accountingPeriodController.unlock);
router.delete('/accounting-periods/:id', protect, requirePermission('accounting', 'delete'), accountingPeriodController.remove);

// GST filing export (slice F.4)
router.get('/gst-filing/gstr-1/export', protect, requirePermission('finance-settings', 'view'), gstFilingController.exportGstr1);
router.get('/gst-filing/gstr-3b/export', protect, requirePermission('finance-settings', 'view'), gstFilingController.exportGstr3b);

// E-invoice (slice G.1)
router.get('/e-invoices', protect, requirePermission('finance-settings', 'view'), eInvoiceController.list);
router.get('/e-invoices/by-invoice/:invoiceId', protect, requirePermission('finance-settings', 'view'), eInvoiceController.getByInvoice);
/**
 * @swagger
 * /admin/e-invoices/generate/{invoiceId}:
 *   post:
 *     tags: [E-Invoice]
 *     summary: Generate IRN for an invoice
 *     parameters:
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: IRN generated
 *       404:
 *         description: Invoice not found
 */
router.post('/e-invoices/generate/:invoiceId', protect, requirePermission('finance-settings', 'create'), eInvoiceController.generate);
router.post('/e-invoices/:id/cancel', protect, requirePermission('finance-settings', 'create'), eInvoiceController.cancel);

// Accounting integrations (slice G.2)
router.get('/accounting-integrations', protect, requirePermission('finance-settings', 'view'), accountingIntegrationController.list);
router.post('/accounting-integrations/:kind/connect', protect, requirePermission('finance-settings', 'create'), accountingIntegrationController.connect);
router.get('/accounting-integrations/:kind/callback', protect, requirePermission('finance-settings', 'view'), accountingIntegrationController.callback);
router.post('/accounting-integrations/:kind/sync', protect, requirePermission('finance-settings', 'create'), accountingIntegrationController.syncNow);
router.delete('/accounting-integrations/:kind', protect, requirePermission('finance-settings', 'delete'), accountingIntegrationController.disconnect);

// Messaging / WhatsApp (slice G.3)
router.get('/messaging/config', protect, requirePermission('settings', 'view'), whatsappController.getConfig);
router.put('/messaging/config', protect, requirePermission('settings', 'edit'), whatsappController.upsertConfig);
router.post('/messaging/whatsapp/send', protect, requirePermission('settings', 'create'), whatsappController.sendMessage);
// Sending an existing invoice via WhatsApp is an invoice action, not a
// Settings action — gating it on the top-level 'settings' module forced
// admins to grant broad Settings access just so staff could send invoices.
// Additive: the original 'settings' check still passes on its own.
router.post('/invoices/:invoiceId/send-whatsapp', protect, requirePermission(['settings', 'invoices'], 'edit'), whatsappController.sendInvoiceWhatsapp);

// AI configuration (cluster H, slice H.1)
router.get('/ai/config', protect, requirePermission('ai', 'view'), aiConfigController.getAiConfig);
router.put('/ai/config', protect, requirePermission('ai', 'edit'), aiConfigController.updateAiConfig);
router.post('/ai/config/test', protect, requirePermission('ai', 'create'), aiConfigController.testAiConfig);
router.delete('/ai/config', protect, requirePermission('ai', 'delete'), aiConfigController.deleteAiConfig);

// AI bill extraction (cluster H, slice H.2)
router.post(
  '/ai/extract-bill',
  protect,
  requirePermission('ai', 'create'),
  requireAiEnabled,
  aiRateLimit,
  uploadAiJobs.single('bill'),
  aiExtractionController.extractBill,
);
router.get('/ai/extract-bill', protect, requirePermission('ai', 'view'), aiExtractionController.listJobs);
router.get('/ai/extract-bill/:id', protect, requirePermission('ai', 'view'), aiExtractionController.getJob);
router.post('/ai/extract-bill/:id/confirm', protect, requirePermission('ai', 'create'), aiExtractionController.confirmJob);
router.post('/ai/extract-bill/:id/discard', protect, requirePermission('ai', 'create'), aiExtractionController.discardJob);

// AI co-pilot chat (cluster H, slice H.3)
// Order matters: the static `/ai/chat/sessions` paths are declared and matched
// distinctly from the streaming `POST /ai/chat`. (Legacy `/ai/chat/:sessionId`
// routes that would have shadowed `/ai/chat/sessions/:id` are unmounted above.)
router.post('/ai/chat', protect, requirePermission('ai', 'create'), requireAiEnabled, aiRateLimit, aiChatController.streamChat);
router.get('/ai/chat/sessions', protect, requirePermission('ai', 'view'), aiChatController.listSessions);
router.get('/ai/chat/sessions/:id', protect, requirePermission('ai', 'view'), aiChatController.getSession);
router.patch('/ai/chat/sessions/:id', protect, requirePermission('ai', 'edit'), aiChatController.renameSession);
router.delete('/ai/chat/sessions/:id', protect, requirePermission('ai', 'delete'), aiChatController.deleteSession);

// AI usage logs / cost reporting (cluster H, slice H.4)
router.get('/ai/usage', protect, requirePermission('ai', 'view'), aiUsageController.getUsage);
router.get('/ai/usage/summary', protect, requirePermission('ai', 'view'), aiUsageController.getUsageSummary);

// Spec D — Approval workflows (maker-checker)
router.get('/approvals/pending', protect, requirePermission('finance-settings', 'view'), approvalsController.listPending);
router.post('/invoices/:id/approve', protect, requirePermission('invoices', 'edit'), invoiceController.approveInvoice);
router.post('/invoices/:id/reject', protect, requirePermission('invoices', 'edit'), invoiceController.rejectInvoice);
router.post('/expenses/:id/approve', protect, requirePermission('expenses', 'edit'), expenseController.approveExpense);
router.post('/expenses/:id/reject', protect, requirePermission('expenses', 'edit'), expenseController.rejectExpense);
router.post('/purchases/:id/approve', protect, requirePermission('purchase-list', 'edit'), purchaseController.approvePurchase);
router.post('/purchases/:id/reject', protect, requirePermission('purchase-list', 'edit'), purchaseController.rejectPurchase);

// Spec G — Exchange-rate CRUD (manual rate table; BYOK rate-API is a future provider)
router.get('/exchange-rates', protect, requirePermission('finance-settings', 'view'), exchangeRateController.listExchangeRates);
router.post('/exchange-rates', protect, requirePermission('finance-settings', 'create'), exchangeRateController.createExchangeRate);
router.delete('/exchange-rates/:id', protect, requirePermission('finance-settings', 'delete'), exchangeRateController.deleteExchangeRate);

// Country accounting packs + ledger setup (slice B.5)
router.get('/ledger/status', protect, requirePermission('accounting', 'view'), ledgerSetup.ledgerStatus);
router.get('/ledger/country-packs', protect, requirePermission('accounting', 'view'), ledgerSetup.listCountryPacks);
router.post('/ledger/setup', protect, requirePermission('accounting', 'create'), ledgerSetup.applyCountryPack);

// Opening-balance cutover (slice B.6)
router.get('/ledger/cutover/preview', protect, requirePermission('accounting', 'view'), ledgerCutover.previewCutoverHandler);
router.post('/ledger/cutover/commit', protect, requirePermission('accounting', 'create'), ledgerCutover.commitCutoverHandler);

// P3.1 — AR/AP Aging + Dunning
router.get('/reports/ar-aging', protect, requirePermission('accounting-reports', 'view'), agingController.arAging);
router.get('/reports/ap-aging', protect, requirePermission('accounting-reports', 'view'), agingController.apAging);
router.get('/reports/collections', protect, requirePermission('accounting-reports', 'view'), agingController.collections);

// Supplier Balances — supplier-wise AP (bills / payments+returns / balance due)
router.get('/reports/supplier-balances.csv', protect, requirePermission('purchase-list', 'view'), supplierBalancesController.supplierBalances);
router.get('/reports/supplier-balances', protect, requirePermission('purchase-list', 'view'), supplierBalancesController.supplierBalances);

// P3.2 — Budget CRUD
router.get('/budgets', protect, requirePermission('finance-settings', 'view'), budgetController.listBudgets);
router.post('/budgets', protect, requirePermission('finance-settings', 'create'), budgetController.createBudget);
router.put('/budgets/:id', protect, requirePermission('finance-settings', 'edit'), budgetController.updateBudget);
router.delete('/budgets/:id', protect, requirePermission('finance-settings', 'delete'), budgetController.deleteBudget);

// P3.2 — Budget Variance + Cash-Flow Forecast reports
router.get('/reports/budget-variance', protect, requirePermission('accounting-reports', 'view'), budgetController.budgetVarianceReport);
router.get('/reports/cash-flow-forecast', protect, requirePermission('accounting-reports', 'view'), budgetController.cashFlowForecastReport);

// GAP 5 — Tally Check / Reconciliation (GL controls vs sub-ledgers + bank)
router.get('/reports/tally-check', protect, requirePermission('accounting-reports', 'view'), reconciliationController.tallyCheck);

// Staff invoice-activity report — invoices created/updated/deleted + value, per staff member
router.get('/reports/staff-activity', protect, requirePermission('accounting-reports', 'view'), staffActivityController.getStaffActivity);

// P3.4 — Fixed Assets + Depreciation
// NOTE: run-depreciation and /search must be declared BEFORE /:id to avoid route shadowing.
router.post('/fixed-assets/run-depreciation', protect, requirePermission('finance-settings', 'edit'), fixedAssetController.runDepreciation);
router.get('/fixed-assets/search', protect, requirePermission(['finance-settings', 'banking'], 'view'), fixedAssetController.searchActiveFixedAssets);
router.get('/fixed-assets', protect, requirePermission('finance-settings', 'view'), fixedAssetController.listFixedAssets);
router.post('/fixed-assets', protect, requirePermission('finance-settings', 'create'), fixedAssetController.createFixedAsset);
router.post('/fixed-assets/:id/dispose', protect, requirePermission('finance-settings', 'edit'), fixedAssetController.disposeFixedAsset);
router.put('/fixed-assets/:id', protect, requirePermission('finance-settings', 'edit'), fixedAssetController.updateFixedAsset);
router.delete('/fixed-assets/:id', protect, requirePermission('finance-settings', 'delete'), fixedAssetController.deleteFixedAsset);

// P3.5 — FIFO cost layers read endpoint
router.get('/inventory/cost-layers', protect, requirePermission('inventory', 'view'), ProductController.listCostLayers);

// M2 — My Money: per-user tax-year consolidation (salary / dividend / director-loan / share-capital)
// #36: gate My Money on its own 'my-money' module (the slug the UI uses),
// not the unrelated 'banking' module that 403'd finance users.
router.get('/my-money/:tenantId', protect, requirePermission('my-money', 'view'), myMoneyController.getMyMoney);

// M2 Phase 2 — Payroll Profiles CRUD (Task 6)
// #36: gate on the dedicated 'payroll' module (matches the UI sidebar slug)
// instead of 'banking' so payroll/finance users are no longer 403'd.
router.get('/payroll/profiles', protect, requirePermission('payroll', 'view'), payrollController.listProfiles);
router.post('/payroll/profiles', protect, requirePermission('payroll', 'create'), payrollController.createProfile);
router.put('/payroll/profiles/:id', protect, requirePermission('payroll', 'edit'), payrollController.updateProfile);
router.delete('/payroll/profiles/:id', protect, requirePermission('payroll', 'delete'), payrollController.deleteProfile);

// M2 Phase 2 — Pay Run lifecycle (Task 7)
router.get('/payroll/runs', protect, requirePermission('payroll', 'view'), payrollController.listRuns);
router.get('/payroll/runs/:id', protect, requirePermission('payroll', 'view'), payrollController.getRun);
router.post('/payroll/runs', protect, requirePermission('payroll', 'create'), payrollController.createRun);
router.put('/payroll/runs/:id', protect, requirePermission('payroll', 'edit'), payrollController.updateRun);
router.post('/payroll/runs/:id/finalize', protect, requirePermission('payroll', 'edit'), payrollController.finalizeRun);
router.post('/payroll/runs/:id/void', protect, requirePermission('payroll', 'edit'), payrollController.voidRun);

// Time Tracking — Phase 1 (Task 4): project members + project billing settings.
// Sub-router (TS) mounted here so its routes live under /api/admin alongside the
// rest of the admin surface. It applies `protect` + `requirePermission` itself.
router.use(timeTrackingRoutes);

// Data export / backup — "own your data" CSV per-module exports + full-tenant
// backup zip. Sub-router (TS) mounted here so its routes live under /api/admin.
// It applies `protect` + `requirePermission` itself.
router.use(exportRoutes);

// Country tax-return summaries — UK VAT 9-box, AU BAS, NZ GST (Task 2). GL-
// derived, on-screen + CSV. Sub-router (TS) mounted here so its routes live
// under /api/admin. It applies `protect` + `requirePermission` itself.
router.use(taxReturnRoutes);

// HMRC Making Tax Digital (MTD) VAT e-filing — connect / obligations / submit /
// liabilities (Task 3). BYOK + off-by-default + mock mode. Sub-router (TS) mounted
// here so its routes live under /api/admin. It applies protect + requirePermission
// (and an Owner gate on credential/connect mutations) itself.
router.use(mtdRoutes);

export default router;
