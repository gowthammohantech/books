// GENERATED FILE — DO NOT EDIT.
// Run `npm run generate --workspace=@elixirbooks/enums` after changing
// apps/api/prisma/schema.prisma. CI fails if this file is out of date.

/** Mirrors the Prisma `AccountType` enum. */
export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'EXPENSE';

export const ACCOUNT_TYPE_VALUES = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
] as const satisfies readonly AccountType[];

/** Mirrors the Prisma `BankTransactionRelatedType` enum. */
export type BankTransactionRelatedType =
  | 'INVOICE_PAYMENT'
  | 'SUPPLIER_PAYMENT'
  | 'PETTYCASH'
  | 'EXPENSE'
  | 'MANUAL';

export const BANK_TRANSACTION_RELATED_TYPE_VALUES = [
  'INVOICE_PAYMENT',
  'SUPPLIER_PAYMENT',
  'PETTYCASH',
  'EXPENSE',
  'MANUAL',
] as const satisfies readonly BankTransactionRelatedType[];

/** Mirrors the Prisma `BusinessType` enum. */
export type BusinessType =
  | 'MANUFACTURING'
  | 'TRADING'
  | 'SERVICES';

export const BUSINESS_TYPE_VALUES = [
  'MANUFACTURING',
  'TRADING',
  'SERVICES',
] as const satisfies readonly BusinessType[];

/** Mirrors the Prisma `BankTransactionType` enum. */
export type BankTransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'PAYMENT'
  | 'RECEIPT';

export const BANK_TRANSACTION_TYPE_VALUES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'PAYMENT',
  'RECEIPT',
] as const satisfies readonly BankTransactionType[];

/** Mirrors the Prisma `CategoryAppliesTo` enum. */
export type CategoryAppliesTo =
  | 'MONEY_IN'
  | 'MONEY_OUT'
  | 'MONEY_IN_USER'
  | 'MONEY_OUT_USER';

export const CATEGORY_APPLIES_TO_VALUES = [
  'MONEY_IN',
  'MONEY_OUT',
  'MONEY_IN_USER',
  'MONEY_OUT_USER',
] as const satisfies readonly CategoryAppliesTo[];

/** Mirrors the Prisma `GatewayKind` enum. */
export type GatewayKind =
  | 'RAZORPAY'
  | 'STRIPE'
  | 'OFFLINE';

export const GATEWAY_KIND_VALUES = [
  'RAZORPAY',
  'STRIPE',
  'OFFLINE',
] as const satisfies readonly GatewayKind[];

/** Mirrors the Prisma `InvoiceStatus` enum. */
export type InvoiceStatus =
  | 'DRAFT'
  | 'UNPAID'
  | 'SENT'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'PARTIALLY_PAID';

export const INVOICE_STATUS_VALUES = [
  'DRAFT',
  'UNPAID',
  'SENT',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'PARTIALLY_PAID',
] as const satisfies readonly InvoiceStatus[];

/** Mirrors the Prisma `LeavePortion` enum. */
export type LeavePortion =
  | 'FULL'
  | 'AM'
  | 'PM';

export const LEAVE_PORTION_VALUES = [
  'FULL',
  'AM',
  'PM',
] as const satisfies readonly LeavePortion[];

/** Mirrors the Prisma `LeaveStatus` enum. */
export type LeaveStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export const LEAVE_STATUS_VALUES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const satisfies readonly LeaveStatus[];

/** Mirrors the Prisma `PaymentTransactionStatus` enum. */
export type PaymentTransactionStatus =
  | 'CREATED'
  | 'PENDING'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export const PAYMENT_TRANSACTION_STATUS_VALUES = [
  'CREATED',
  'PENDING',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const satisfies readonly PaymentTransactionStatus[];

/** Mirrors the Prisma `PurchaseStatus` enum. */
export type PurchaseStatus =
  | 'new'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'partially_paid'
  | 'paid';

export const PURCHASE_STATUS_VALUES = [
  'new',
  'pending',
  'completed',
  'cancelled',
  'partially_paid',
  'paid',
] as const satisfies readonly PurchaseStatus[];

/** Mirrors the Prisma `ProjectMemberRole` enum. */
export type ProjectMemberRole =
  | 'MEMBER'
  | 'MANAGER';

export const PROJECT_MEMBER_ROLE_VALUES = [
  'MEMBER',
  'MANAGER',
] as const satisfies readonly ProjectMemberRole[];

/** Mirrors the Prisma `RecurrenceCustomIntervalType` enum. */
export type RecurrenceCustomIntervalType =
  | 'day'
  | 'week'
  | 'month'
  | 'year';

export const RECURRENCE_CUSTOM_INTERVAL_TYPE_VALUES = [
  'day',
  'week',
  'month',
  'year',
] as const satisfies readonly RecurrenceCustomIntervalType[];

/** Mirrors the Prisma `RecurrenceFrequency` enum. */
export type RecurrenceFrequency =
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'custom';

export const RECURRENCE_FREQUENCY_VALUES = [
  'day',
  'week',
  'month',
  'year',
  'custom',
] as const satisfies readonly RecurrenceFrequency[];

/** Mirrors the Prisma `RecurringScheduleStatus` enum. */
export type RecurringScheduleStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED'
  | 'COMPLETED';

export const RECURRING_SCHEDULE_STATUS_VALUES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'COMPLETED',
] as const satisfies readonly RecurringScheduleStatus[];

/** Mirrors the Prisma `TaxKind` enum. */
export type TaxKind =
  | 'CGST'
  | 'SGST'
  | 'IGST'
  | 'UTGST'
  | 'CESS'
  | 'VAT'
  | 'SALES_TAX';

export const TAX_KIND_VALUES = [
  'CGST',
  'SGST',
  'IGST',
  'UTGST',
  'CESS',
  'VAT',
  'SALES_TAX',
] as const satisfies readonly TaxKind[];

/** Mirrors the Prisma `TaxRegime` enum. */
export type TaxRegime =
  | 'GST_INDIA'
  | 'VAT_GENERIC'
  | 'US_SALES_TAX'
  | 'NONE'
  | 'VAT_UK'
  | 'VAT_EU'
  | 'GST_AU'
  | 'GST_NZ';

export const TAX_REGIME_VALUES = [
  'GST_INDIA',
  'VAT_GENERIC',
  'US_SALES_TAX',
  'NONE',
  'VAT_UK',
  'VAT_EU',
  'GST_AU',
  'GST_NZ',
] as const satisfies readonly TaxRegime[];

/** Mirrors the Prisma `TaxTreatment` enum. */
export type TaxTreatment =
  | 'STANDARD'
  | 'ZERO_RATED'
  | 'EXEMPT'
  | 'REVERSE_CHARGE'
  | 'OUT_OF_SCOPE';

export const TAX_TREATMENT_VALUES = [
  'STANDARD',
  'ZERO_RATED',
  'EXEMPT',
  'REVERSE_CHARGE',
  'OUT_OF_SCOPE',
] as const satisfies readonly TaxTreatment[];

/** Mirrors the Prisma `TimesheetStatus` enum. */
export type TimesheetStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export const TIMESHEET_STATUS_VALUES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const satisfies readonly TimesheetStatus[];
