-- CreateEnum
CREATE TYPE "UserGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "UserBalanceType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "ModuleUserType" AS ENUM ('ADMIN', 'TYPE_TWO', 'TYPE_THREE');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('savings', 'current');

-- CreateEnum
CREATE TYPE "BankTransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'PAYMENT', 'RECEIPT');

-- CreateEnum
CREATE TYPE "BankTransactionRelatedType" AS ENUM ('INVOICE_PAYMENT', 'SUPPLIER_PAYMENT', 'PETTYCASH', 'EXPENSE', 'MANUAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "InventoryHistoryType" AS ENUM ('stock_in', 'stock_out', 'adjustment');

-- CreateEnum
CREATE TYPE "InventoryHistoryReferenceType" AS ENUM ('purchase', 'invoice', 'return_', 'adjustment');

-- CreateEnum
CREATE TYPE "ProductItemType" AS ENUM ('Product', 'Service');

-- CreateEnum
CREATE TYPE "SupplierBalanceType" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "SupplierPaymentSourceType" AS ENUM ('BANK', 'PETTY_CASH');

-- CreateEnum
CREATE TYPE "CreditNoteReason" AS ENUM ('RETURN', 'DAMAGED_GOODS', 'WRONG_ITEM', 'OVERCHARGE', 'CANCELLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditNoteRefundMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_TO_ACCOUNT', 'NONE');

-- CreateEnum
CREATE TYPE "SignType" AS ENUM ('none', 'digitalSignature', 'eSignature');

-- CreateEnum
CREATE TYPE "DebitNoteStatus" AS ENUM ('new', 'pending', 'completed', 'cancelled', 'partially_paid', 'paid');

-- CreateEnum
CREATE TYPE "DeliveryChallanStatus" AS ENUM ('PENDING', 'DELIVERED', 'CANCELLED', 'DRAFT');

-- CreateEnum
CREATE TYPE "EmailTemplateStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'UNPAID', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED', 'PARTIALLY_PAID');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('day', 'week', 'month', 'year', 'custom');

-- CreateEnum
CREATE TYPE "RecurrenceCustomIntervalType" AS ENUM ('day', 'week', 'month', 'year');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('draft', 'sent', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "QuotationConvertType" AS ENUM ('quotation', 'invoice', 'purchase');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('automatic', 'manual', 'automatic_Purchase', 'manual_purchase', 'automatic_quotation', 'manual_quotation');

-- CreateEnum
CREATE TYPE "ReminderTiming" AS ENUM ('before', 'after', 'duedate');

-- CreateEnum
CREATE TYPE "ReminderEvent" AS ENUM ('due_date', 'invoice_date', 'payment_date', 'quotation_date', 'expiry_date');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('PAID', 'CANCELLED', 'PENDING');

-- CreateEnum
CREATE TYPE "ExpenseSourceType" AS ENUM ('BANK', 'PETTY_CASH');

-- CreateEnum
CREATE TYPE "PettyCashTransactionType" AS ENUM ('ADD', 'SPEND', 'RETURN');

-- CreateEnum
CREATE TYPE "PettyCashTransactionRelatedType" AS ENUM ('PETTY_CASH', 'SUPPLIER_PAYMENT', 'EXPENSE', 'BANK');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('new', 'pending', 'completed', 'cancelled', 'partially_paid', 'paid');

-- CreateEnum
CREATE TYPE "PurchaseSignType" AS ENUM ('none', 'digitalSignature', 'eSignature');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('new', 'pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "PurchaseOrderPaymentMode" AS ENUM ('CASH', 'CREDIT', 'CHECK', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseOrderSignType" AS ENUM ('digitalSignature', 'eSignature', 'none');

-- CreateEnum
CREATE TYPE "PurchaseOrderConvertType" AS ENUM ('purchase', 'estimate', 'invoice');

-- CreateEnum
CREATE TYPE "EmailSettingsProviderType" AS ENUM ('NODE', 'SMTP');

-- CreateEnum
CREATE TYPE "LocalizationStartWeek" AS ENUM ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday');

-- CreateEnum
CREATE TYPE "CustomFieldStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "CustomFieldDataTypeKind" AS ENUM ('text', 'number', 'email', 'date', 'time', 'boolean', 'array', 'object', 'set', 'function', 'textarea', 'select', 'checkbox', 'radio', 'currency');

-- CreateEnum
CREATE TYPE "CustomFieldValueModule" AS ENUM ('invoice', 'purchase', 'inventory', 'customer', 'supplier', 'expense', 'purchaseOrder');

-- CreateEnum
CREATE TYPE "FieldTypeStatus" AS ENUM ('Active', 'Inactive');

-- CreateEnum
CREATE TYPE "NotificationTagStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "NotificationTypeStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AIDocumentType" AS ENUM ('invoice', 'purchase_order', 'quotation', 'expense');

-- CreateEnum
CREATE TYPE "AIChatSessionStatus" AS ENUM ('active', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "AIConfigurationDefaultTaxType" AS ENUM ('GST', 'CGST_SGST', 'IGST', 'VAT', 'none');

-- CreateEnum
CREATE TYPE "AIPromptLogStatus" AS ENUM ('pending', 'processed', 'confirmed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AIPromptLogCreatedDocumentType" AS ENUM ('Invoice', 'PurchaseOrder', 'Quotation', 'Expense');

-- CreateEnum
CREATE TYPE "AIPromptTemplateDocumentType" AS ENUM ('invoice', 'purchase_order', 'quotation', 'expense', 'any');

-- CreateEnum
CREATE TYPE "ConversationDocumentType" AS ENUM ('invoice', 'quotation', 'expense');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'completed', 'expired');

-- CreateTable
CREATE TABLE "LoginActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "location" TEXT DEFAULT 'Unknown',
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "moduleName" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL,
    "parentId" TEXT,
    "userType" "ModuleUserType" NOT NULL DEFAULT 'ADMIN',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "moduleId" TEXT,
    "create" BOOLEAN NOT NULL DEFAULT false,
    "edit" BOOLEAN NOT NULL DEFAULT false,
    "delete" BOOLEAN NOT NULL DEFAULT false,
    "view" BOOLEAN NOT NULL DEFAULT false,
    "allowAll" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "gender" "UserGender",
    "dateOfBirth" TIMESTAMP(3),
    "password" TEXT NOT NULL,
    "profileImage" TEXT,
    "address" TEXT,
    "countryId" TEXT,
    "stateId" TEXT,
    "cityId" TEXT,
    "postalCode" TEXT,
    "user_type" INTEGER NOT NULL DEFAULT 1,
    "roleId" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance_type" "UserBalanceType",
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDetail" (
    "id" TEXT NOT NULL,
    "accountHoldername" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "IFSCCode" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL,
    "openingBalance" DECIMAL(18,4) DEFAULT 0,
    "currentBalance" DECIMAL(18,4) DEFAULT 0,
    "asOnDate" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "BankTransactionType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceBefore" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "paymentModeId" TEXT NOT NULL,
    "referenceNo" TEXT,
    "remarks" TEXT,
    "relatedType" "BankTransactionRelatedType" DEFAULT 'MANUAL',
    "relatedId" TEXT,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledBy" TEXT,
    "reconciliationDate" TIMESTAMP(3),
    "reconciliationNote" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "brand_image" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category_image" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT DEFAULT '',
    "externalSource" TEXT,
    "externalRef" TEXT,
    "website" TEXT DEFAULT '',
    "image" TEXT DEFAULT '',
    "notes" TEXT DEFAULT '',
    "status" "CustomerStatus" NOT NULL DEFAULT 'Active',
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "bankDetails" JSONB,
    "userId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "inventory_history" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "item_type" "ProductItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "selling_price" DOUBLE PRECISION NOT NULL,
    "purchase_price" DOUBLE PRECISION NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DOUBLE PRECISION NOT NULL,
    "taxGroupId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "alert_quantity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "product_image" TEXT NOT NULL,
    "gallery_images" JSONB,
    "enable_inventory" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "signatureName" TEXT NOT NULL,
    "signatureImage" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "markAsDefault" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "supplier_email" TEXT NOT NULL,
    "supplier_phone" TEXT NOT NULL,
    "balance" DOUBLE PRECISION DEFAULT 0,
    "balance_type" "SupplierBalanceType",
    "status" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "purchaseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentModeId" TEXT,
    "sourceType" "SupplierPaymentSourceType" NOT NULL,
    "bankId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL,
    "dueAmount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "attachment" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "creditNoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceNo" TEXT DEFAULT '',
    "reason" "CreditNoteReason" DEFAULT 'OTHER',
    "description" TEXT DEFAULT '',
    "items" JSONB,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'PENDING',
    "refund_method" "CreditNoteRefundMethod" NOT NULL DEFAULT 'CREDIT_TO_ACCOUNT',
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "vat" DECIMAL(18,4) DEFAULT 0,
    "totalDiscount" DECIMAL(18,4) DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "bankId" TEXT,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "SignType" NOT NULL DEFAULT 'none',
    "signatureName" TEXT,
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "appliedToInvoice" TEXT,
    "appliedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitNote" (
    "id" TEXT NOT NULL,
    "debitNoteId" TEXT,
    "purchaseId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "debitNoteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "DebitNoteStatus" DEFAULT 'new',
    "paymentModeId" TEXT,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalDiscount" DECIMAL(18,4) DEFAULT 0,
    "totalTax" DECIMAL(18,4) DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) DEFAULT 0,
    "balanceAmount" DECIMAL(18,4) DEFAULT 0,
    "bankId" TEXT,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "SignType" NOT NULL DEFAULT 'none',
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "signatureName" TEXT,
    "checkNumber" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryChallan" (
    "id" TEXT NOT NULL,
    "challanNumber" TEXT,
    "invoiceId" TEXT,
    "customerId" TEXT NOT NULL,
    "challanDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "DeliveryChallanStatus" NOT NULL DEFAULT 'DRAFT',
    "bankId" TEXT,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "vat" DECIMAL(18,4) DEFAULT 0,
    "totalDiscount" DECIMAL(18,4) DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "SignType" NOT NULL DEFAULT 'none',
    "signatureName" TEXT,
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "receivedBy" TEXT DEFAULT '',
    "receivedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryChallan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notificationTypeId" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT NOT NULL,
    "sms_content" TEXT,
    "notification_content" TEXT,
    "status" "EmailTemplateStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "customerId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_method" TEXT,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "TotalAmount" DECIMAL(18,4) NOT NULL,
    "vat" DECIMAL(18,4) DEFAULT 0,
    "totalDiscount" DECIMAL(18,4) DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "bankId" TEXT,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "parentInvoice" TEXT,
    "repeatEvery" "RecurrenceFrequency" DEFAULT 'month',
    "customIntervalNumber" INTEGER,
    "customIntervalType" "RecurrenceCustomIntervalType",
    "startOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "neverExpire" BOOLEAN NOT NULL DEFAULT false,
    "stopped" BOOLEAN NOT NULL DEFAULT false,
    "lastRecurringDate" TIMESTAMP(3),
    "nextRecurringDate" TIMESTAMP(3),
    "sign_type" "SignType" NOT NULL DEFAULT 'none',
    "signatureName" TEXT,
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paymentModeId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "received_on" TIMESTAMP(3) NOT NULL,
    "notes" TEXT DEFAULT '',
    "received_by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" TEXT NOT NULL,
    "default_invoice_template" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT,
    "customerId" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "QuotationStatus" NOT NULL DEFAULT 'draft',
    "paymentTerms" TEXT,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalDiscount" DECIMAL(18,4) DEFAULT 0,
    "vat" DECIMAL(18,4) DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "TotalAmount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "SignType" NOT NULL DEFAULT 'none',
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "signatureName" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "salesPerson" TEXT,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "bankId" TEXT,
    "invoiceId" TEXT,
    "convert_type" "QuotationConvertType" NOT NULL DEFAULT 'quotation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReminderType" NOT NULL DEFAULT 'automatic',
    "remindDays" INTEGER,
    "remindTiming" "ReminderTiming" DEFAULT 'after',
    "remindEvent" "ReminderEvent" DEFAULT 'due_date',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailConfig" JSONB NOT NULL,
    "targetInvoice" TEXT,
    "targetQuotation" TEXT,
    "targetCustomer" TEXT,
    "manualReminderData" JSONB,
    "createdBy" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'active',
    "lastSent" TIMESTAMP(3),
    "nextSend" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT,
    "referenceNo" TEXT DEFAULT '',
    "amount" DECIMAL(18,4) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentModeId" TEXT,
    "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT DEFAULT '',
    "attachment" TEXT,
    "expenseCategoryId" TEXT NOT NULL,
    "sourceType" "ExpenseSourceType" NOT NULL,
    "bankId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseChangeLog" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changes" JSONB,
    "changeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCash" (
    "id" TEXT NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "asOnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PettyCashTransaction" (
    "id" TEXT NOT NULL,
    "pettyCashId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionType" "PettyCashTransactionType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balanceBefore" DECIMAL(18,4) NOT NULL,
    "balanceAfter" DECIMAL(18,4) NOT NULL,
    "remarks" TEXT,
    "relatedType" "PettyCashTransactionRelatedType" NOT NULL,
    "relatedId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "purchaseOrderId" TEXT,
    "vendorId" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'pending',
    "paymentModeId" TEXT,
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bankId" TEXT,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "PurchaseSignType" NOT NULL DEFAULT 'none',
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "signatureName" TEXT,
    "checkNumber" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "vendorId" TEXT,
    "purchaseOrderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT DEFAULT '',
    "items" JSONB,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'new',
    "paymentMode" "PurchaseOrderPaymentMode",
    "taxableAmount" DECIMAL(18,4) NOT NULL,
    "totalDiscount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "vat" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "roundOff" BOOLEAN NOT NULL DEFAULT false,
    "TotalAmount" DECIMAL(18,4) NOT NULL,
    "bankId" TEXT,
    "notes" TEXT,
    "termsAndCondition" TEXT,
    "sign_type" "PurchaseOrderSignType" NOT NULL DEFAULT 'none',
    "signatureId" TEXT,
    "signatureImage" TEXT,
    "signatureName" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "billFrom" TEXT NOT NULL,
    "billTo" TEXT NOT NULL,
    "convert_type" "PurchaseOrderConvertType" NOT NULL DEFAULT 'purchase',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "state_id" TEXT,
    "country_id" TEXT,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "country_id" TEXT,
    "state_code" TEXT,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "iso3" TEXT,
    "iso2" TEXT,
    "phonecode" TEXT,
    "capital" TEXT,
    "currency" TEXT,
    "native" TEXT,
    "region" TEXT,
    "subregion" TEXT,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "siteLogo" TEXT DEFAULT '',
    "favicon" TEXT DEFAULT '',
    "companyLogo" TEXT DEFAULT '',
    "companyBanner" TEXT DEFAULT '',
    "fax" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" BOOLEAN DEFAULT true,
    "isDefault" BOOLEAN DEFAULT false,
    "isDeleted" BOOLEAN DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DateFormat" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "isDeleted" BOOLEAN DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DateFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL,
    "provider_type" "EmailSettingsProviderType" NOT NULL,
    "nodeFromName" TEXT,
    "nodeFromEmail" TEXT,
    "nodeHost" TEXT,
    "nodePort" TEXT,
    "nodeUsername" TEXT,
    "nodePassword" TEXT,
    "smtpFromName" TEXT,
    "smtpFromEmail" TEXT,
    "smtpHost" TEXT,
    "smtpPort" TEXT,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "smtp_status" BOOLEAN DEFAULT false,
    "node_status" BOOLEAN DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneralSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "groupSlug" TEXT DEFAULT 'general',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Localization" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "dateFormatId" TEXT NOT NULL,
    "timeFormatId" TEXT NOT NULL,
    "timezoneId" TEXT NOT NULL,
    "startWeek" "LocalizationStartWeek" DEFAULT 'Monday',
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Localization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMode" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxGroup" (
    "id" TEXT NOT NULL,
    "tax_name" TEXT NOT NULL,
    "status" BOOLEAN DEFAULT true,
    "created_on" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "tax_name" TEXT NOT NULL,
    "tax_rate" DECIMAL(8,4) NOT NULL,
    "status" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeFormat" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "isDeleted" BOOLEAN DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timezone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "utc_offset" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timezone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "status" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "fieldSlug" TEXT NOT NULL,
    "fieldTypeId" TEXT NOT NULL,
    "helpText" TEXT DEFAULT '',
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "showInTable" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "status" "CustomFieldStatus" NOT NULL DEFAULT 'Active',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDataType" (
    "id" TEXT NOT NULL,
    "type" "CustomFieldDataTypeKind" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDataType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "module" "CustomFieldValueModule" NOT NULL,
    "recordId" TEXT NOT NULL,
    "value" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "FieldTypeStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTag" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "NotificationTagStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationType" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "NotificationTypeStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTypeTag" (
    "id" TEXT NOT NULL,
    "notificationTypeId" TEXT NOT NULL,
    "notificationTagId" TEXT NOT NULL,

    CONSTRAINT "NotificationTypeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIChatSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "messages" JSONB,
    "documentType" "AIDocumentType",
    "currentExtractedData" JSONB,
    "status" "AIChatSessionStatus" NOT NULL DEFAULT 'active',
    "createdDocumentId" TEXT,
    "userId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConfiguration" (
    "id" TEXT NOT NULL,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "enabledModulesInvoice" BOOLEAN NOT NULL DEFAULT true,
    "enabledModulesPurchaseOrder" BOOLEAN NOT NULL DEFAULT true,
    "enabledModulesQuotation" BOOLEAN NOT NULL DEFAULT true,
    "enabledModulesExpense" BOOLEAN NOT NULL DEFAULT true,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'INR',
    "defaultTaxType" "AIConfigurationDefaultTaxType" NOT NULL DEFAULT 'GST',
    "autoApplyTax" BOOLEAN NOT NULL DEFAULT true,
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 15,
    "maxPromptsPerDay" INTEGER NOT NULL DEFAULT 100,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptLog" (
    "id" TEXT NOT NULL,
    "promptId" TEXT,
    "prompt" TEXT NOT NULL,
    "documentType" "AIDocumentType" NOT NULL,
    "extractedData" JSONB,
    "status" "AIPromptLogStatus" NOT NULL DEFAULT 'pending',
    "createdDocumentId" TEXT,
    "createdDocumentType" "AIPromptLogCreatedDocumentType",
    "processingTimeMs" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "userId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "documentType" "AIPromptTemplateDocumentType" NOT NULL DEFAULT 'any',
    "category" TEXT NOT NULL DEFAULT 'General',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "documentType" "ConversationDocumentType",
    "context" JSONB,
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TaxGroupTaxRates" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BankDetail_accountNumber_key" ON "BankDetail"("accountNumber");

-- CreateIndex
CREATE INDEX "BankDetail_userId_idx" ON "BankDetail"("userId");

-- CreateIndex
CREATE INDEX "BankDetail_isDeleted_idx" ON "BankDetail"("isDeleted");

-- CreateIndex
CREATE INDEX "BankDetail_status_idx" ON "BankDetail"("status");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_idx" ON "BankTransaction"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_transactionDate_idx" ON "BankTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "BankTransaction_relatedType_relatedId_idx" ON "BankTransaction"("relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "BankTransaction_isDeleted_idx" ON "BankTransaction"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_brand_name_key" ON "Brand"("brand_name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_category_name_key" ON "Category"("category_name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_externalSource_externalRef_userId_key" ON "Customer"("externalSource", "externalRef", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplier_email_key" ON "Supplier"("supplier_email");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentId_key" ON "SupplierPayment"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Counter_key_key" ON "Counter"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNumber_key" ON "CreditNote"("creditNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DebitNote_debitNoteId_key" ON "DebitNote"("debitNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChallan_challanNumber_key" ON "DeliveryChallan"("challanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationId_key" ON "Quotation"("quotationId");

-- CreateIndex
CREATE INDEX "Reminder_createdBy_status_idx" ON "Reminder"("createdBy", "status");

-- CreateIndex
CREATE INDEX "Reminder_type_status_idx" ON "Reminder"("type", "status");

-- CreateIndex
CREATE INDEX "Reminder_companyId_status_idx" ON "Reminder"("companyId", "status");

-- CreateIndex
CREATE INDEX "Reminder_nextSend_isEnabled_idx" ON "Reminder"("nextSend", "isEnabled");

-- CreateIndex
CREATE INDEX "Reminder_targetInvoice_idx" ON "Reminder"("targetInvoice");

-- CreateIndex
CREATE INDEX "Reminder_targetQuotation_idx" ON "Reminder"("targetQuotation");

-- CreateIndex
CREATE INDEX "Reminder_targetCustomer_idx" ON "Reminder"("targetCustomer");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_expenseId_key" ON "Expense"("expenseId");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_pettyCashId_idx" ON "PettyCashTransaction"("pettyCashId");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_transactionDate_idx" ON "PettyCashTransaction"("transactionDate");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_relatedType_relatedId_idx" ON "PettyCashTransaction"("relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "PettyCashTransaction_isDeleted_idx" ON "PettyCashTransaction"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_purchaseId_key" ON "Purchase"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_purchaseOrderId_key" ON "PurchaseOrder"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "City_state_id_idx" ON "City"("state_id");

-- CreateIndex
CREATE INDEX "City_country_id_idx" ON "City"("country_id");

-- CreateIndex
CREATE INDEX "State_country_id_idx" ON "State"("country_id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySettings_userId_key" ON "CompanySettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DateFormat_title_key" ON "DateFormat"("title");

-- CreateIndex
CREATE UNIQUE INDEX "DateFormat_format_key" ON "DateFormat"("format");

-- CreateIndex
CREATE INDEX "DateFormat_title_idx" ON "DateFormat"("title");

-- CreateIndex
CREATE INDEX "DateFormat_format_idx" ON "DateFormat"("format");

-- CreateIndex
CREATE UNIQUE INDEX "GeneralSetting_key_key" ON "GeneralSetting"("key");

-- CreateIndex
CREATE INDEX "GeneralSetting_key_idx" ON "GeneralSetting"("key");

-- CreateIndex
CREATE INDEX "GeneralSetting_groupSlug_idx" ON "GeneralSetting"("groupSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Localization_userId_isActive_key" ON "Localization"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMode_name_key" ON "PaymentMode"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMode_slug_key" ON "PaymentMode"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TimeFormat_name_key" ON "TimeFormat"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TimeFormat_format_key" ON "TimeFormat"("format");

-- CreateIndex
CREATE INDEX "TimeFormat_name_idx" ON "TimeFormat"("name");

-- CreateIndex
CREATE INDEX "TimeFormat_format_idx" ON "TimeFormat"("format");

-- CreateIndex
CREATE UNIQUE INDEX "Timezone_name_key" ON "Timezone"("name");

-- CreateIndex
CREATE INDEX "CustomField_moduleId_fieldSlug_idx" ON "CustomField"("moduleId", "fieldSlug");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDataType_type_key" ON "CustomFieldDataType"("type");

-- CreateIndex
CREATE INDEX "CustomFieldDataType_isActive_idx" ON "CustomFieldDataType"("isActive");

-- CreateIndex
CREATE INDEX "CustomFieldDataType_createdBy_idx" ON "CustomFieldDataType"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "FieldType_slug_key" ON "FieldType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationType_slug_key" ON "NotificationType"("slug");

-- CreateIndex
CREATE INDEX "NotificationTypeTag_notificationTagId_idx" ON "NotificationTypeTag"("notificationTagId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTypeTag_notificationTypeId_notificationTagId_key" ON "NotificationTypeTag"("notificationTypeId", "notificationTagId");

-- CreateIndex
CREATE UNIQUE INDEX "AIChatSession_sessionId_key" ON "AIChatSession"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AIConfiguration_userId_key" ON "AIConfiguration"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptLog_promptId_key" ON "AIPromptLog"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_sessionId_key" ON "Conversation"("sessionId");

-- CreateIndex
CREATE INDEX "Conversation_expiresAt_idx" ON "Conversation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "_TaxGroupTaxRates_AB_unique" ON "_TaxGroupTaxRates"("A", "B");

-- CreateIndex
CREATE INDEX "_TaxGroupTaxRates_B_index" ON "_TaxGroupTaxRates"("B");

-- AddForeignKey
ALTER TABLE "LoginActivity" ADD CONSTRAINT "LoginActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetail" ADD CONSTRAINT "BankDetail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankDetail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_reconciledBy_fkey" FOREIGN KEY ("reconciledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxGroupId_fkey" FOREIGN KEY ("taxGroupId") REFERENCES "TaxGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_appliedToInvoice_fkey" FOREIGN KEY ("appliedToInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryChallan" ADD CONSTRAINT "DeliveryChallan_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "NotificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_parentInvoice_fkey" FOREIGN KEY ("parentInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTemplate" ADD CONSTRAINT "InvoiceTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_salesPerson_fkey" FOREIGN KEY ("salesPerson") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_targetInvoice_fkey" FOREIGN KEY ("targetInvoice") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_targetQuotation_fkey" FOREIGN KEY ("targetQuotation") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_targetCustomer_fkey" FOREIGN KEY ("targetCustomer") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CompanySettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseChangeLog" ADD CONSTRAINT "ExpenseChangeLog_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseChangeLog" ADD CONSTRAINT "ExpenseChangeLog_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashTransaction" ADD CONSTRAINT "PettyCashTransaction_pettyCashId_fkey" FOREIGN KEY ("pettyCashId") REFERENCES "PettyCash"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "BankDetail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_billFrom_fkey" FOREIGN KEY ("billFrom") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_billTo_fkey" FOREIGN KEY ("billTo") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "State" ADD CONSTRAINT "State_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Currency" ADD CONSTRAINT "Currency_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateFormat" ADD CONSTRAINT "DateFormat_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateFormat" ADD CONSTRAINT "DateFormat_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSettings" ADD CONSTRAINT "EmailSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSetting" ADD CONSTRAINT "GeneralSetting_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneralSetting" ADD CONSTRAINT "GeneralSetting_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localization" ADD CONSTRAINT "Localization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localization" ADD CONSTRAINT "Localization_dateFormatId_fkey" FOREIGN KEY ("dateFormatId") REFERENCES "DateFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localization" ADD CONSTRAINT "Localization_timeFormatId_fkey" FOREIGN KEY ("timeFormatId") REFERENCES "TimeFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Localization" ADD CONSTRAINT "Localization_timezoneId_fkey" FOREIGN KEY ("timezoneId") REFERENCES "Timezone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeFormat" ADD CONSTRAINT "TimeFormat_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeFormat" ADD CONSTRAINT "TimeFormat_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_fieldTypeId_fkey" FOREIGN KEY ("fieldTypeId") REFERENCES "FieldType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDataType" ADD CONSTRAINT "CustomFieldDataType_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTypeTag" ADD CONSTRAINT "NotificationTypeTag_notificationTypeId_fkey" FOREIGN KEY ("notificationTypeId") REFERENCES "NotificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTypeTag" ADD CONSTRAINT "NotificationTypeTag_notificationTagId_fkey" FOREIGN KEY ("notificationTagId") REFERENCES "NotificationTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIChatSession" ADD CONSTRAINT "AIChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConfiguration" ADD CONSTRAINT "AIConfiguration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptLog" ADD CONSTRAINT "AIPromptLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptTemplate" ADD CONSTRAINT "AIPromptTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaxGroupTaxRates" ADD CONSTRAINT "_TaxGroupTaxRates_A_fkey" FOREIGN KEY ("A") REFERENCES "TaxGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaxGroupTaxRates" ADD CONSTRAINT "_TaxGroupTaxRates_B_fkey" FOREIGN KEY ("B") REFERENCES "TaxRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
