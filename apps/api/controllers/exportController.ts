// controllers/exportController.ts
//
// "Own your data" — machine-readable CSV exports per accounting module plus a
// one-click full-tenant backup zip. Every query is tenant-scoped via
// requireTenantId (= ownerId ?? id), so a caller can only ever pull their own
// tenant's rows. All CSV passes through lib/export/csv.ts which is
// CSV-injection-safe (leading = + - @ \t \r neutralised) and RFC-4180 quoted.

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import archiver from 'archiver';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import { toCsv, type CsvColumn } from '../lib/export/csv';
import {
  profitLossFrom,
  balanceSheetFrom,
  trialBalanceFrom,
  type AccountBalance,
} from '../lib/ledger/statements';
import {
  bucketAging,
  buildSubLedgerAging,
  creditNoteTotalsByInvoice,
  netInvoiceOutstanding,
  type AgingItem,
  type AgingResult,
} from '../lib/reports/aging';
import { loadArSubLedger, loadApSubLedger } from '../lib/reports/agingSubLedger';
import { parseAsOf } from '../lib/reports/asOf';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

const APP_VERSION = process.env.APP_VERSION || '1.0.4';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }
  console.error(`export ${what} error:`, err);
  res.status(500).json({ success: false, message: `Failed to export ${what}` });
}

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

const dec = (v: unknown): string => (v == null ? '' : String(v));
const iso = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');

// Shared GL loader (mirrors financialStatementsController.loadAccountBalances).
async function loadAccountBalances(tenantId: string, opts: { from?: Date; to: Date }): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { tenantId, isDeleted: false },
    include: {
      journalLines: {
        where: {
          journalEntry: {
            tenantId,
            isDeleted: false,
            entryDate: opts.from ? { gte: opts.from, lte: opts.to } : { lte: opts.to },
          },
        },
        select: { baseDebit: true, baseCredit: true },
      },
      roleMappings: { select: { roleKey: true } },
    },
    orderBy: { code: 'asc' },
  });
  return accounts.map((a) => {
    const debit = a.journalLines.reduce((s, l) => s.plus(l.baseDebit), new Prisma.Decimal(0));
    const credit = a.journalLines.reduce((s, l) => s.plus(l.baseCredit), new Prisma.Decimal(0));
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      parentId: a.parentId ?? null,
      debit: debit.toString(),
      credit: credit.toString(),
      role: a.roleMappings[0]?.roleKey ?? null,
    };
  });
}

async function ledgerLive(tenantId: string): Promise<boolean> {
  const s = await prisma.companySettings.findFirst({ where: { tenantId }, select: { ledgerInitialized: true } });
  return !!s?.ledgerInitialized;
}

function dateRange(req: Request): { fromDate: Date; toDate: Date } {
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getFullYear(), 0, 1);
  toDate.setHours(23, 59, 59, 999);
  fromDate.setHours(0, 0, 0, 0);
  return { fromDate, toDate };
}

// ---------------------------------------------------------------------------
// Data builders — each returns { columns, rows } so they can be reused by both
// the per-module endpoint and the backup zip.
// ---------------------------------------------------------------------------

async function buildJournalEntries(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const lines = await prisma.journalLine.findMany({
    where: { journalEntry: { tenantId, isDeleted: false } },
    select: {
      debit: true,
      credit: true,
      baseDebit: true,
      baseCredit: true,
      description: true,
      account: { select: { code: true, name: true } },
      journalEntry: {
        select: { entryNumber: true, entryDate: true, description: true, reference: true, sourceType: true },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }],
  });
  const rows = lines.map((l) => ({
    entryNumber: l.journalEntry.entryNumber ?? '',
    entryDate: iso(l.journalEntry.entryDate),
    accountCode: l.account.code,
    accountName: l.account.name,
    debit: dec(l.debit),
    credit: dec(l.credit),
    baseDebit: dec(l.baseDebit),
    baseCredit: dec(l.baseCredit),
    reference: l.journalEntry.reference ?? '',
    narration: l.description ?? l.journalEntry.description ?? '',
    source: l.journalEntry.sourceType ?? 'manual',
  }));
  const columns: CsvColumn[] = [
    { key: 'entryNumber', header: 'Entry Number' },
    { key: 'entryDate', header: 'Entry Date' },
    { key: 'accountCode', header: 'Account Code' },
    { key: 'accountName', header: 'Account Name' },
    { key: 'debit', header: 'Debit' },
    { key: 'credit', header: 'Credit' },
    { key: 'baseDebit', header: 'Base Debit' },
    { key: 'baseCredit', header: 'Base Credit' },
    { key: 'reference', header: 'Reference' },
    { key: 'narration', header: 'Narration' },
    { key: 'source', header: 'Source' },
  ];
  return { columns, rows };
}

async function buildChartOfAccounts(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const accounts = await prisma.account.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      code: true,
      name: true,
      accountType: true,
      currencyCode: true,
      parent: { select: { code: true, name: true } },
    },
    orderBy: { code: 'asc' },
  });
  const rows = accounts.map((a) => ({
    code: a.code,
    name: a.name,
    accountType: a.accountType,
    parentCode: a.parent?.code ?? '',
    parentName: a.parent?.name ?? '',
    currencyCode: a.currencyCode ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'accountType', header: 'Account Type' },
    { key: 'parentCode', header: 'Parent Code' },
    { key: 'parentName', header: 'Parent Name' },
    { key: 'currencyCode', header: 'Currency' },
  ];
  return { columns, rows };
}

async function buildInvoices(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      status: true,
      invoiceType: true,
      currencyCode: true,
      taxableAmount: true,
      vat: true,
      totalDiscount: true,
      TotalAmount: true,
      customer: { select: { name: true } },
      contact: { select: { organisation: true, firstName: true, lastName: true } },
      payments: { where: { isVoided: false }, select: { amount: true } },
    },
    orderBy: { invoiceDate: 'asc' },
  });
  const rows = invoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s.plus(new Prisma.Decimal(p.amount.toString())), new Prisma.Decimal(0));
    const balance = new Prisma.Decimal(inv.TotalAmount.toString()).minus(paid);
    const customerName =
      inv.customer?.name ??
      inv.contact?.organisation ??
      `${inv.contact?.firstName ?? ''} ${inv.contact?.lastName ?? ''}`.trim();
    return {
      invoiceNumber: inv.invoiceNumber ?? '',
      invoiceType: inv.invoiceType,
      invoiceDate: iso(inv.invoiceDate),
      dueDate: iso(inv.dueDate),
      customer: customerName,
      status: inv.status,
      currencyCode: inv.currencyCode ?? '',
      subtotal: dec(inv.taxableAmount),
      discount: dec(inv.totalDiscount),
      tax: dec(inv.vat),
      total: dec(inv.TotalAmount),
      balance: balance.toString(),
    };
  });
  const columns: CsvColumn[] = [
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'invoiceType', header: 'Type' },
    { key: 'invoiceDate', header: 'Date' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'customer', header: 'Customer' },
    { key: 'status', header: 'Status' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'discount', header: 'Discount' },
    { key: 'tax', header: 'Tax' },
    { key: 'total', header: 'Total' },
    { key: 'balance', header: 'Balance Due' },
  ];
  return { columns, rows };
}

// Invoice line items live in the Invoice.items JSON column (no separate table).
// We flatten them, keyed by invoice number, so line detail is exportable.
async function buildInvoiceItems(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, isDeleted: false },
    select: { invoiceNumber: true, invoiceDate: true, items: true },
    orderBy: { invoiceDate: 'asc' },
  });
  const rows: Record<string, unknown>[] = [];
  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? (inv.items as Record<string, unknown>[]) : [];
    for (const it of items) {
      const item = it ?? {};
      rows.push({
        invoiceNumber: inv.invoiceNumber ?? '',
        invoiceDate: iso(inv.invoiceDate),
        item: item.name ?? item.productName ?? item.description ?? '',
        description: item.description ?? '',
        quantity: item.quantity ?? item.qty ?? '',
        rate: item.rate ?? item.price ?? item.unitPrice ?? item.selling_price ?? '',
        discount: item.discount ?? item.discount_value ?? '',
        tax: item.tax ?? item.taxAmount ?? item.vat ?? '',
        amount: item.amount ?? item.total ?? item.lineTotal ?? '',
      });
    }
  }
  const columns: CsvColumn[] = [
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'invoiceDate', header: 'Invoice Date' },
    { key: 'item', header: 'Item' },
    { key: 'description', header: 'Description' },
    { key: 'quantity', header: 'Quantity' },
    { key: 'rate', header: 'Rate' },
    { key: 'discount', header: 'Discount' },
    { key: 'tax', header: 'Tax' },
    { key: 'amount', header: 'Amount' },
  ];
  return { columns, rows };
}

// Products became tenant-owned in P4. Until then this was the one export that
// legitimately was not tenant-scoped, because the catalogue genuinely was
// shared; leaving it unscoped now would put every other company's product
// list, costs and margins into this company's backup zip.
async function buildProducts(
  tenantId: string,
): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: {
      code: true,
      name: true,
      item_type: true,
      barcode: true,
      selling_price: true,
      purchase_price: true,
      discount_type: true,
      discount_value: true,
      stock: true,
      alert_quantity: true,
      enable_inventory: true,
      status: true,
      currencyCode: true,
      category: { select: { category_name: true } },
      brand: { select: { brand_name: true } },
      unit: { select: { unit_name: true } },
      taxGroup: { select: { tax_name: true } },
    },
    orderBy: { name: 'asc' },
  });
  const rows = products.map((p) => ({
    code: p.code,
    name: p.name,
    itemType: p.item_type,
    barcode: p.barcode,
    category: p.category?.category_name ?? '',
    brand: p.brand?.brand_name ?? '',
    unit: p.unit?.unit_name ?? '',
    taxGroup: p.taxGroup?.tax_name ?? '',
    sellingPrice: dec(p.selling_price),
    purchasePrice: dec(p.purchase_price),
    discountType: p.discount_type,
    discountValue: dec(p.discount_value),
    stock: p.stock,
    alertQuantity: p.alert_quantity,
    inventoryEnabled: p.enable_inventory,
    status: p.status,
    currencyCode: p.currencyCode ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'itemType', header: 'Type' },
    { key: 'barcode', header: 'Barcode' },
    { key: 'category', header: 'Category' },
    { key: 'brand', header: 'Brand' },
    { key: 'unit', header: 'Unit' },
    { key: 'taxGroup', header: 'Tax Group' },
    { key: 'sellingPrice', header: 'Selling Price' },
    { key: 'purchasePrice', header: 'Purchase Price' },
    { key: 'discountType', header: 'Discount Type' },
    { key: 'discountValue', header: 'Discount Value' },
    { key: 'stock', header: 'Stock' },
    { key: 'alertQuantity', header: 'Alert Quantity' },
    { key: 'inventoryEnabled', header: 'Inventory Enabled' },
    { key: 'status', header: 'Status' },
    { key: 'currencyCode', header: 'Currency' },
  ];
  return { columns, rows };
}

// Bank transactions have no direct tenantId — scoped via bankAccount.tenantId.
async function buildBankTransactions(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const txns = await prisma.bankTransaction.findMany({
    where: { isDeleted: false, bankAccount: { tenantId } },
    select: {
      transactionDate: true,
      type: true,
      amount: true,
      balanceAfter: true,
      referenceNo: true,
      remarks: true,
      isReconciled: true,
      explainStatus: true,
      bankAccount: { select: { bankName: true, accountNumber: true } },
      category: { select: { name: true } },
    },
    orderBy: { transactionDate: 'asc' },
  });
  const rows = txns.map((t) => ({
    transactionDate: iso(t.transactionDate),
    bankName: t.bankAccount.bankName,
    accountNumber: t.bankAccount.accountNumber,
    type: t.type,
    amount: dec(t.amount),
    balanceAfter: dec(t.balanceAfter),
    category: t.category?.name ?? '',
    referenceNo: t.referenceNo ?? '',
    remarks: t.remarks ?? '',
    reconciled: t.isReconciled,
    explainStatus: t.explainStatus,
  }));
  const columns: CsvColumn[] = [
    { key: 'transactionDate', header: 'Date' },
    { key: 'bankName', header: 'Bank' },
    { key: 'accountNumber', header: 'Account Number' },
    { key: 'type', header: 'Type' },
    { key: 'amount', header: 'Amount' },
    { key: 'balanceAfter', header: 'Balance After' },
    { key: 'category', header: 'Category' },
    { key: 'referenceNo', header: 'Reference' },
    { key: 'remarks', header: 'Remarks' },
    { key: 'reconciled', header: 'Reconciled' },
    { key: 'explainStatus', header: 'Explain Status' },
  ];
  return { columns, rows };
}

// Customers — mirror the existing /contacts/export shape isn't possible 1:1
// (Customer is a distinct model), but we expose the round-trippable fields the
// customer CSV importer consumes.
async function buildCustomers(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const customers = await prisma.customer.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      name: true,
      email: true,
      phone: true,
      whatsapp: true,
      website: true,
      gstin: true,
      currencyCode: true,
      status: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { name: 'asc' },
  });
  const rows = customers.map((c) => ({
    name: c.name,
    email: c.email,
    phone: c.phone ?? '',
    whatsapp: c.whatsapp ?? '',
    website: c.website ?? '',
    gstin: c.gstin ?? '',
    currencyCode: c.currencyCode ?? '',
    status: c.status,
    notes: c.notes ?? '',
    createdAt: iso(c.createdAt),
  }));
  const columns: CsvColumn[] = [
    { key: 'name', header: 'name' },
    { key: 'email', header: 'email' },
    { key: 'phone', header: 'phone' },
    { key: 'whatsapp', header: 'whatsapp' },
    { key: 'website', header: 'website' },
    { key: 'gstin', header: 'gstin' },
    { key: 'currencyCode', header: 'currencyCode' },
    { key: 'status', header: 'status' },
    { key: 'notes', header: 'notes' },
    { key: 'createdAt', header: 'createdAt' },
  ];
  return { columns, rows };
}

async function buildContacts(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const contacts = await prisma.contact.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      organisation: true, firstName: true, lastName: true, email: true, billingEmail: true,
      telephone: true, mobile: true, addressLine1: true, addressLine2: true, addressLine3: true,
      town: true, region: true, postcode: true, currencyCode: true, vatRegNumber: true, gstin: true,
      status: true, createdAt: true,
    },
    orderBy: { organisation: 'asc' },
  });
  const rows = contacts.map((c) => ({
    organisation: c.organisation ?? '', firstName: c.firstName ?? '', lastName: c.lastName ?? '',
    email: c.email ?? '', billingEmail: c.billingEmail ?? '', telephone: c.telephone ?? '',
    mobile: c.mobile ?? '', addressLine1: c.addressLine1 ?? '', addressLine2: c.addressLine2 ?? '',
    addressLine3: c.addressLine3 ?? '', town: c.town ?? '', region: c.region ?? '',
    postcode: c.postcode ?? '', currencyCode: c.currencyCode ?? '', vatRegNumber: c.vatRegNumber ?? '',
    gstin: c.gstin ?? '', status: c.status, createdAt: iso(c.createdAt),
  }));
  const columns: CsvColumn[] = Object.keys(rows[0] ?? {
    organisation: '', firstName: '', lastName: '', email: '', billingEmail: '', telephone: '',
    mobile: '', addressLine1: '', addressLine2: '', addressLine3: '', town: '', region: '',
    postcode: '', currencyCode: '', vatRegNumber: '', gstin: '', status: '', createdAt: '',
  }).map((k) => ({ key: k }));
  return { columns, rows };
}

async function buildPurchases(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const purchases = await prisma.purchase.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      purchaseId: true, purchaseDate: true, dueDate: true, status: true, referenceNo: true,
      currencyCode: true, taxableAmount: true, totalTax: true, totalDiscount: true,
      totalAmount: true, paidAmount: true, balanceAmount: true,
      supplier: { select: { supplier_name: true } },
      contact: { select: { organisation: true, firstName: true, lastName: true } },
    },
    orderBy: { purchaseDate: 'asc' },
  });
  const rows = purchases.map((p) => ({
    purchaseId: p.purchaseId ?? '',
    purchaseDate: iso(p.purchaseDate),
    dueDate: iso(p.dueDate),
    supplier:
      p.supplier?.supplier_name ??
      p.contact?.organisation ??
      `${p.contact?.firstName ?? ''} ${p.contact?.lastName ?? ''}`.trim(),
    status: p.status,
    referenceNo: p.referenceNo ?? '',
    currencyCode: p.currencyCode ?? '',
    subtotal: dec(p.taxableAmount),
    discount: dec(p.totalDiscount),
    tax: dec(p.totalTax),
    total: dec(p.totalAmount),
    paid: dec(p.paidAmount),
    balance: dec(p.balanceAmount),
  }));
  const columns: CsvColumn[] = [
    { key: 'purchaseId', header: 'Purchase ID' },
    { key: 'purchaseDate', header: 'Date' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'supplier', header: 'Supplier' },
    { key: 'status', header: 'Status' },
    { key: 'referenceNo', header: 'Reference' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'discount', header: 'Discount' },
    { key: 'tax', header: 'Tax' },
    { key: 'total', header: 'Total' },
    { key: 'paid', header: 'Paid' },
    { key: 'balance', header: 'Balance' },
  ];
  return { columns, rows };
}

async function buildExpenses(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const expenses = await prisma.expense.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      expenseId: true, expenseDate: true, amount: true, tax: true, paymentStatus: true,
      description: true, referenceNo: true, currencyCode: true,
      expenseCategory: { select: { title: true } },
      supplier: { select: { supplier_name: true } },
      // Contact-first party resolution (matches getPurchaseReport/arAging):
      // expenses created via the unified-contact flow have contactId set but a
      // null legacy `supplier`, so reading only `supplier` left the name blank.
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
    },
    orderBy: { expenseDate: 'asc' },
  });
  const rows = expenses.map((e) => ({
    expenseId: e.expenseId ?? '',
    expenseDate: iso(e.expenseDate),
    category: e.expenseCategory?.title ?? '',
    supplier: (e.contact ? resolveDisplayName(e.contact) : '') || e.supplier?.supplier_name || '',
    amount: dec(e.amount),
    tax: dec(e.tax),
    currencyCode: e.currencyCode ?? '',
    paymentStatus: e.paymentStatus,
    referenceNo: e.referenceNo ?? '',
    description: e.description ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'expenseId', header: 'Expense ID' },
    { key: 'expenseDate', header: 'Date' },
    { key: 'category', header: 'Category' },
    { key: 'supplier', header: 'Supplier' },
    { key: 'amount', header: 'Amount' },
    { key: 'tax', header: 'Tax' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'paymentStatus', header: 'Payment Status' },
    { key: 'referenceNo', header: 'Reference' },
    { key: 'description', header: 'Description' },
  ];
  return { columns, rows };
}

async function buildInvoicePayments(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const payments = await prisma.invoicePayment.findMany({
    where: { invoice: { tenantId, isDeleted: false }, isVoided: false },
    select: {
      amount: true, received_on: true, reference: true, notes: true, currencyCode: true,
      invoice: { select: { invoiceNumber: true } },
      paymentMode: { select: { name: true } },
    },
    orderBy: { received_on: 'asc' },
  });
  const rows = payments.map((p) => ({
    invoiceNumber: p.invoice.invoiceNumber ?? '',
    receivedOn: iso(p.received_on),
    amount: dec(p.amount),
    currencyCode: p.currencyCode ?? '',
    paymentMode: p.paymentMode?.name ?? '',
    reference: p.reference ?? '',
    notes: p.notes ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'receivedOn', header: 'Received On' },
    { key: 'amount', header: 'Amount' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'paymentMode', header: 'Payment Mode' },
    { key: 'reference', header: 'Reference' },
    { key: 'notes', header: 'Notes' },
  ];
  return { columns, rows };
}

async function buildCreditNotes(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const notes = await prisma.creditNote.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      creditNoteNumber: true, creditNoteDate: true, status: true, reason: true, currencyCode: true,
      taxableAmount: true, vat: true, totalAmount: true,
      invoice: { select: { invoiceNumber: true } },
      customer: { select: { name: true } },
      // Contact-first party resolution (see buildExpenses).
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
    },
    orderBy: { creditNoteDate: 'asc' },
  });
  const rows = notes.map((n) => ({
    creditNoteNumber: n.creditNoteNumber ?? '',
    creditNoteDate: iso(n.creditNoteDate),
    invoiceNumber: n.invoice?.invoiceNumber ?? '',
    customer: (n.contact ? resolveDisplayName(n.contact) : '') || n.customer?.name || '',
    status: n.status,
    reason: n.reason ?? '',
    currencyCode: n.currencyCode ?? '',
    subtotal: dec(n.taxableAmount),
    tax: dec(n.vat),
    total: dec(n.totalAmount),
  }));
  const columns: CsvColumn[] = [
    { key: 'creditNoteNumber', header: 'Credit Note Number' },
    { key: 'creditNoteDate', header: 'Date' },
    { key: 'invoiceNumber', header: 'Invoice Number' },
    { key: 'customer', header: 'Customer' },
    { key: 'status', header: 'Status' },
    { key: 'reason', header: 'Reason' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'tax', header: 'Tax' },
    { key: 'total', header: 'Total' },
  ];
  return { columns, rows };
}

async function buildDebitNotes(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const notes = await prisma.debitNote.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      debitNoteId: true, debitNoteDate: true, status: true, currencyCode: true,
      taxableAmount: true, totalTax: true, totalAmount: true,
      purchase: { select: { purchaseId: true } },
      supplier: { select: { supplier_name: true } },
      // Contact-first party resolution (see buildExpenses).
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
    },
    orderBy: { debitNoteDate: 'asc' },
  });
  const rows = notes.map((n) => ({
    debitNoteId: n.debitNoteId ?? '',
    debitNoteDate: iso(n.debitNoteDate),
    purchaseId: n.purchase?.purchaseId ?? '',
    supplier: (n.contact ? resolveDisplayName(n.contact) : '') || n.supplier?.supplier_name || '',
    status: n.status ?? '',
    currencyCode: n.currencyCode ?? '',
    subtotal: dec(n.taxableAmount),
    tax: dec(n.totalTax),
    total: dec(n.totalAmount),
  }));
  const columns: CsvColumn[] = [
    { key: 'debitNoteId', header: 'Debit Note ID' },
    { key: 'debitNoteDate', header: 'Date' },
    { key: 'purchaseId', header: 'Purchase ID' },
    { key: 'supplier', header: 'Supplier' },
    { key: 'status', header: 'Status' },
    { key: 'currencyCode', header: 'Currency' },
    { key: 'subtotal', header: 'Subtotal' },
    { key: 'tax', header: 'Tax' },
    { key: 'total', header: 'Total' },
  ];
  return { columns, rows };
}

async function buildProjects(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const projects = await prisma.project.findMany({
    where: { tenantId },
    select: { code: true, name: true, status: true, billingRate: true, startDate: true, endDate: true, description: true },
    orderBy: { code: 'asc' },
  });
  const rows = projects.map((p) => ({
    code: p.code,
    name: p.name,
    status: p.status,
    billingRate: dec(p.billingRate),
    startDate: iso(p.startDate),
    endDate: iso(p.endDate),
    description: p.description ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    { key: 'status', header: 'Status' },
    { key: 'billingRate', header: 'Billing Rate' },
    { key: 'startDate', header: 'Start Date' },
    { key: 'endDate', header: 'End Date' },
    { key: 'description', header: 'Description' },
  ];
  return { columns, rows };
}

async function buildTimeEntries(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const entries = await prisma.timeEntry.findMany({
    where: { timesheet: { tenantId } },
    select: {
      date: true, hours: true, billable: true, note: true,
      project: { select: { code: true, name: true } },
      timesheet: {
        select: {
          weekStartDate: true, status: true,
          employee: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
    orderBy: { date: 'asc' },
  });
  const rows = entries.map((e) => ({
    date: iso(e.date),
    weekStartDate: iso(e.timesheet.weekStartDate),
    employee: `${e.timesheet.employee.firstName ?? ''} ${e.timesheet.employee.lastName ?? ''}`.trim(),
    employeeEmail: e.timesheet.employee.email ?? '',
    projectCode: e.project.code,
    projectName: e.project.name,
    hours: dec(e.hours),
    billable: e.billable,
    timesheetStatus: e.timesheet.status,
    note: e.note ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'date', header: 'Date' },
    { key: 'weekStartDate', header: 'Week Start' },
    { key: 'employee', header: 'Employee' },
    { key: 'employeeEmail', header: 'Employee Email' },
    { key: 'projectCode', header: 'Project Code' },
    { key: 'projectName', header: 'Project Name' },
    { key: 'hours', header: 'Hours' },
    { key: 'billable', header: 'Billable' },
    { key: 'timesheetStatus', header: 'Timesheet Status' },
    { key: 'note', header: 'Note' },
  ];
  return { columns, rows };
}

async function buildLeaveRequests(tenantId: string): Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> {
  const requests = await prisma.leaveRequest.findMany({
    where: { tenantId },
    select: {
      startDate: true, endDate: true, status: true, totalDays: true, reason: true,
      leaveType: { select: { name: true } },
      employee: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { startDate: 'asc' },
  });
  const rows = requests.map((r) => ({
    employee: `${r.employee.firstName ?? ''} ${r.employee.lastName ?? ''}`.trim(),
    employeeEmail: r.employee.email ?? '',
    leaveType: r.leaveType.name,
    startDate: iso(r.startDate),
    endDate: iso(r.endDate),
    totalDays: dec(r.totalDays),
    status: r.status,
    reason: r.reason ?? '',
  }));
  const columns: CsvColumn[] = [
    { key: 'employee', header: 'Employee' },
    { key: 'employeeEmail', header: 'Employee Email' },
    { key: 'leaveType', header: 'Leave Type' },
    { key: 'startDate', header: 'Start Date' },
    { key: 'endDate', header: 'End Date' },
    { key: 'totalDays', header: 'Total Days' },
    { key: 'status', header: 'Status' },
    { key: 'reason', header: 'Reason' },
  ];
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Report builders — reuse the same ledger libs the report controllers use.
// ---------------------------------------------------------------------------

async function buildTrialBalance(tenantId: string, asOf: Date) {
  const balances = await loadAccountBalances(tenantId, { to: asOf });
  const tb = trialBalanceFrom(balances);
  const rows = tb.accounts.map((a) => ({
    code: a.code,
    name: a.name,
    accountType: a.accountType,
    debit: a.totalDebit,
    credit: a.totalCredit,
    net: a.net,
  }));
  rows.push({ code: '', name: 'TOTAL', accountType: '' as never, debit: tb.totals.debit, credit: tb.totals.credit, net: tb.totals.debit - tb.totals.credit });
  const columns: CsvColumn[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Account' },
    { key: 'accountType', header: 'Type' },
    { key: 'debit', header: 'Debit' },
    { key: 'credit', header: 'Credit' },
    { key: 'net', header: 'Net' },
  ];
  return { columns, rows };
}

async function buildBalanceSheet(tenantId: string, asOf: Date) {
  const balances = await loadAccountBalances(tenantId, { to: asOf });
  const bs = balanceSheetFrom(balances);
  const rows: Record<string, unknown>[] = [
    { section: 'Assets', line: 'Cash & Bank', amount: bs.assets.current.cashAndBank },
    { section: 'Assets', line: 'Receivables', amount: bs.assets.current.receivables },
    { section: 'Assets', line: 'Inventory', amount: bs.assets.current.inventory },
    { section: 'Assets', line: 'Total Assets', amount: bs.assets.total },
    { section: 'Liabilities', line: 'Payables', amount: bs.liabilities.current.payables },
    { section: 'Liabilities', line: 'Tax Liability', amount: bs.liabilities.current.taxLiability },
    { section: 'Liabilities', line: 'Other', amount: bs.liabilities.current.other },
    { section: 'Liabilities', line: 'Total Liabilities', amount: bs.liabilities.total },
    { section: 'Equity', line: 'Owner Equity', amount: bs.equity.ownerEquity },
    { section: 'Equity', line: 'Retained Earnings', amount: bs.equity.retainedEarnings },
    { section: 'Equity', line: 'Total Equity', amount: bs.equity.total },
    { section: 'Total', line: 'Total Liabilities + Equity', amount: bs.totalLiabilitiesAndEquity },
  ];
  const columns: CsvColumn[] = [
    { key: 'section', header: 'Section' },
    { key: 'line', header: 'Line' },
    { key: 'amount', header: 'Amount' },
  ];
  return { columns, rows };
}

async function buildProfitAndLoss(tenantId: string, from: Date, to: Date) {
  const balances = await loadAccountBalances(tenantId, { from, to });
  const pl = profitLossFrom(balances);
  const rows: Record<string, unknown>[] = [];
  rows.push({ section: 'Revenue', line: 'Total Revenue', amount: pl.revenue.total });
  for (const c of pl.revenue.byCategory) rows.push({ section: 'Revenue', line: c.name, amount: c.total });
  rows.push({ section: 'COGS', line: 'Cost of Goods Sold', amount: pl.costOfGoodsSold.total });
  rows.push({ section: 'Summary', line: 'Gross Profit', amount: pl.grossProfit });
  rows.push({ section: 'Operating Expenses', line: 'Total Operating Expenses', amount: pl.operatingExpenses.total });
  for (const c of pl.operatingExpenses.byCategory) rows.push({ section: 'Operating Expenses', line: c.name, amount: c.total });
  rows.push({ section: 'Summary', line: 'Operating Income', amount: pl.operatingIncome });
  rows.push({ section: 'Summary', line: 'Net Income', amount: pl.netIncome });
  const columns: CsvColumn[] = [
    { key: 'section', header: 'Section' },
    { key: 'line', header: 'Line' },
    { key: 'amount', header: 'Amount' },
  ];
  return { columns, rows };
}

function agingRowsToCsv(result: AgingResult): { columns: CsvColumn[]; rows: Record<string, unknown>[] } {
  const rows = result.rows.map((r) => ({
    reference: r.label,
    amount: Number(r.amount),
    dueDate: r.dueDate.toISOString().slice(0, 10),
    daysOverdue: r.daysOverdue,
    bucket: r.bucket,
  }));
  const columns: CsvColumn[] = [
    { key: 'reference', header: 'Reference' },
    { key: 'amount', header: 'Amount' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'daysOverdue', header: 'Days Overdue' },
    { key: 'bucket', header: 'Bucket' },
  ];
  return { columns, rows };
}

async function buildArAging(tenantId: string, asOf: Date): Promise<AgingResult> {
  if (await ledgerLive(tenantId)) {
    const sub = await loadArSubLedger(prisma, tenantId, asOf);
    if (sub.available) {
      return buildSubLedgerAging(sub.lines, asOf, {
        nature: 'debit',
        docs: sub.docs,
        unappliedLabel: 'Unapplied credits / opening balance',
      });
    }
  }
  // Point-in-time as-of asOf (mirrors agingController.arAging legacy path).
  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId, isDeleted: false, invoiceType: 'INVOICE',
      status: { notIn: ['DRAFT', 'CANCELLED'] },
      invoiceDate: { lte: asOf },
    },
    select: {
      id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, TotalAmount: true,
      customer: { select: { name: true } },
      // Contact-first party resolution (see agingController.arAging).
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
      payments: { where: { isVoided: false, received_on: { lte: asOf } }, select: { amount: true } },
    },
  });
  const invoiceIds = invoices.map((i) => i.id);
  const creditNoteByInvoice =
    invoiceIds.length > 0
      ? creditNoteTotalsByInvoice(
          await prisma.creditNote.findMany({
            where: { tenantId, isDeleted: false, invoiceId: { in: invoiceIds }, creditNoteDate: { lte: asOf } },
            select: { invoiceId: true, totalAmount: true },
          }),
        )
      : new Map<string, Prisma.Decimal>();
  const items: AgingItem[] = [];
  for (const inv of invoices) {
    const paid = inv.payments.reduce((a, p) => a.add(new Prisma.Decimal(p.amount.toString())), new Prisma.Decimal(0));
    const cn = creditNoteByInvoice.get(inv.id) ?? new Prisma.Decimal(0);
    const outstanding = netInvoiceOutstanding(inv.TotalAmount, paid, cn);
    if (outstanding.lte(0)) continue;
    const partyName = (inv.contact ? resolveDisplayName(inv.contact) : '') || inv.customer?.name || '';
    items.push({
      id: inv.id,
      label: `${inv.invoiceNumber ?? inv.id} / ${partyName}`.trim(),
      amount: outstanding.toString(),
      dueDate: inv.dueDate ?? inv.invoiceDate,
    });
  }
  return bucketAging(items, asOf);
}

async function buildApAging(tenantId: string, asOf: Date): Promise<AgingResult> {
  if (await ledgerLive(tenantId)) {
    const sub = await loadApSubLedger(prisma, tenantId, asOf);
    if (sub.available) {
      return buildSubLedgerAging(sub.lines, asOf, {
        nature: 'credit',
        docs: sub.docs,
        unappliedLabel: 'Unapplied debits / opening balance',
      });
    }
  }
  // Point-in-time as-of asOf (mirrors agingController.apAging legacy path):
  // balance-at-asOf = current balanceAmount + Σ supplier payments after asOf.
  const purchases = await prisma.purchase.findMany({
    where: {
      tenantId, isDeleted: false,
      status: { not: 'cancelled' },
      purchaseDate: { lte: asOf },
    },
    select: {
      id: true, purchaseId: true, dueDate: true, balanceAmount: true,
      supplier: { select: { supplier_name: true } },
      // Contact-first party resolution (see agingController.apAging).
      contact: { select: { id: true, firstName: true, lastName: true, organisation: true } },
      supplierPayments: { where: { isVoided: false, paymentDate: { gt: asOf } }, select: { amount: true } },
    },
  });
  const items: AgingItem[] = [];
  for (const p of purchases) {
    const laterPaid = p.supplierPayments.reduce(
      (a, sp) => a.add(new Prisma.Decimal(sp.amount.toString())),
      new Prisma.Decimal(0),
    );
    const outstanding = new Prisma.Decimal(p.balanceAmount.toString()).add(laterPaid);
    if (outstanding.lte(0)) continue;
    const partyName = (p.contact ? resolveDisplayName(p.contact) : '') || p.supplier?.supplier_name || '';
    items.push({
      id: p.id,
      label: `${p.purchaseId ?? p.id} / ${partyName}`.trim(),
      amount: outstanding.toString(),
      dueDate: p.dueDate,
    });
  }
  return bucketAging(items, asOf);
}

// ===========================================================================
// Per-module CSV endpoints
// ===========================================================================

export async function exportJournalEntries(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildJournalEntries(tenantId);
    sendCsv(res, 'journal-entries.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'journal entries');
  }
}

export async function exportChartOfAccounts(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildChartOfAccounts(tenantId);
    sendCsv(res, 'chart-of-accounts.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'chart of accounts');
  }
}

export async function exportInvoices(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildInvoices(tenantId);
    sendCsv(res, 'invoices.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'invoices');
  }
}

export async function exportInvoiceItems(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildInvoiceItems(tenantId);
    sendCsv(res, 'invoice-items.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'invoice items');
  }
}

export async function exportProducts(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildProducts(tenantId);
    sendCsv(res, 'products.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'products');
  }
}

export async function exportBankTransactions(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildBankTransactions(tenantId);
    sendCsv(res, 'bank-transactions.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'bank transactions');
  }
}

export async function exportCustomers(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { columns, rows } = await buildCustomers(tenantId);
    sendCsv(res, 'customers.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'customers');
  }
}

export async function exportTrialBalance(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const asOf = parseAsOf(req.query.asOf);
    const { columns, rows } = await buildTrialBalance(tenantId, asOf);
    sendCsv(res, 'trial-balance.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'trial balance');
  }
}

export async function exportBalanceSheet(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const asOf = parseAsOf(req.query.asOf);
    const { columns, rows } = await buildBalanceSheet(tenantId, asOf);
    sendCsv(res, 'balance-sheet.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'balance sheet');
  }
}

export async function exportProfitAndLoss(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { fromDate, toDate } = dateRange(req);
    const { columns, rows } = await buildProfitAndLoss(tenantId, fromDate, toDate);
    sendCsv(res, 'profit-and-loss.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'profit and loss');
  }
}

export async function exportArAging(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const asOf = parseAsOf(req.query.asOf);
    const result = await buildArAging(tenantId, asOf);
    const { columns, rows } = agingRowsToCsv(result);
    sendCsv(res, 'ar-aging.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'AR aging');
  }
}

export async function exportApAging(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const asOf = parseAsOf(req.query.asOf);
    const result = await buildApAging(tenantId, asOf);
    const { columns, rows } = agingRowsToCsv(result);
    sendCsv(res, 'ap-aging.csv', toCsv(rows, columns));
  } catch (err) {
    handleError(res, err, 'AP aging');
  }
}

// ===========================================================================
// Full-tenant backup zip — owner-gated, streamed.
// ===========================================================================

export async function exportBackupZip(req: Request, res: Response): Promise<void> {
  let tenantId: string;
  try {
    tenantId = requireTenantId(req);
  } catch (err) {
    handleError(res, err, 'backup');
    return;
  }

  // Each table -> a builder that yields { columns, rows }. Listed in the
  // manifest with its rowcount. Products is the only non-tenant-scoped table
  // (global catalogue) — included so an install's catalogue is captured too.
  const tables: { name: string; build: () => Promise<{ columns: CsvColumn[]; rows: Record<string, unknown>[] }> }[] = [
    { name: 'chart-of-accounts', build: () => buildChartOfAccounts(tenantId) },
    { name: 'journal-entries', build: () => buildJournalEntries(tenantId) },
    { name: 'invoices', build: () => buildInvoices(tenantId) },
    { name: 'invoice-items', build: () => buildInvoiceItems(tenantId) },
    { name: 'invoice-payments', build: () => buildInvoicePayments(tenantId) },
    { name: 'credit-notes', build: () => buildCreditNotes(tenantId) },
    { name: 'debit-notes', build: () => buildDebitNotes(tenantId) },
    { name: 'purchases', build: () => buildPurchases(tenantId) },
    { name: 'expenses', build: () => buildExpenses(tenantId) },
    { name: 'products', build: () => buildProducts(tenantId) },
    { name: 'customers', build: () => buildCustomers(tenantId) },
    { name: 'contacts', build: () => buildContacts(tenantId) },
    { name: 'bank-transactions', build: () => buildBankTransactions(tenantId) },
    { name: 'projects', build: () => buildProjects(tenantId) },
    { name: 'timesheets', build: () => buildTimeEntries(tenantId) },
    { name: 'leave-requests', build: () => buildLeaveRequests(tenantId) },
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="elixirbooks-backup-${stamp}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('export backup archive error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to build backup' });
    else res.destroy(err);
  });
  archive.pipe(res);

  const manifest: {
    exportedAt: string;
    tenantId: string;
    appVersion: string;
    tables: Record<string, number>;
  } = { exportedAt: new Date().toISOString(), tenantId: tenantId, appVersion: APP_VERSION, tables: {} };

  try {
    for (const t of tables) {
      const { columns, rows } = await t.build();
      manifest.tables[t.name] = rows.length;
      archive.append(toCsv(rows, columns), { name: `${t.name}.csv` });
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    await archive.finalize();
  } catch (err) {
    console.error('export backup build error:', err);
    archive.abort();
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to build backup' });
  }
}

const handlers = {
  exportJournalEntries,
  exportChartOfAccounts,
  exportInvoices,
  exportInvoiceItems,
  exportProducts,
  exportBankTransactions,
  exportCustomers,
  exportTrialBalance,
  exportBalanceSheet,
  exportProfitAndLoss,
  exportArAging,
  exportApAging,
  exportBackupZip,
};
module.exports = handlers;
module.exports.default = handlers;
