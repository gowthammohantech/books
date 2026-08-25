import fs from 'fs';

import type { Request, Response } from 'express';
import type { Customer, Prisma } from '@prisma/client';
import { validationResult } from 'express-validator';
import { parse } from 'csv-parse/sync';

import { prisma } from '../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../lib/tenantScope';

// CC.1: resolve the company default currency code (ISO string).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

interface CustomerResponse {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
  notes: string | null;
  status: Customer['status'];
  imageUrl: string | null;
  totalInvoiceCount: number;
  invoiceTotal: number;
  paymentTotal: number;
  balanceAmount: number;
  billingAddress: Prisma.JsonValue | null;
  shippingAddress: Prisma.JsonValue | null;
  bankDetails: Prisma.JsonValue | null;
  currencyCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceTotals {
  totalInvoiceCount: number;
  invoiceTotal: number;
  paymentTotal: number;
}

const ZERO_TOTALS: InvoiceTotals = {
  totalInvoiceCount: 0,
  invoiceTotal: 0,
  paymentTotal: 0,
};

function formatCustomer(c: Customer, totals: InvoiceTotals): CustomerResponse {
  const baseUrl = process.env.BASE_URL ?? '';
  const imageUrl = c.image ? `${baseUrl}/${c.image.replace(/\\/g, '/')}` : null;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    website: c.website,
    notes: c.notes,
    status: c.status,
    imageUrl,
    totalInvoiceCount: totals.totalInvoiceCount,
    invoiceTotal: totals.invoiceTotal,
    paymentTotal: totals.paymentTotal,
    balanceAmount: totals.invoiceTotal - totals.paymentTotal,
    billingAddress: c.billingAddress as Prisma.JsonValue | null,
    shippingAddress: c.shippingAddress as Prisma.JsonValue | null,
    bankDetails: c.bankDetails as Prisma.JsonValue | null,
    currencyCode: c.currencyCode ?? null, // CC.1
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function tryUnlink(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('Could not unlink upload', filePath, err);
  }
}

function parseMaybeJson(v: unknown): Prisma.InputJsonValue {
  if (typeof v !== 'string') return v as Prisma.InputJsonValue;
  try {
    return JSON.parse(v) as Prisma.InputJsonValue;
  } catch {
    return v as Prisma.InputJsonValue;
  }
}

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

export async function createCustomer(req: Request, res: Response): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (req.file?.path) tryUnlink(req.file.path);
    res.status(400).json({
      success: false,
      errors: errors.array().map((e) => e.msg),
    });
    return;
  }

  try {
    const userId = requireUserId(req);

    const {
      name,
      email,
      phone,
      website,
      notes,
      status,
      billingAddress,
      shippingAddress,
      bankDetails,
      profile_image_removed,
      currencyCode: rawCurrencyCode,
    } = req.body as Record<string, unknown>;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      tryUnlink(req.file?.path);
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const existing = await prisma.customer.findFirst({
      where: { userId, email: email as string },
    });
    if (existing) {
      tryUnlink(req.file?.path);
      res.status(409).json({
        success: false,
        message: 'Customer with this email already exists',
      });
      return;
    }

    // CC.1: use caller-supplied currencyCode or fall back to the company default.
    const customerCurrencyCode =
      (typeof rawCurrencyCode === 'string' && rawCurrencyCode ? rawCurrencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    const imagePath = profile_image_removed === 'true' ? '' : (req.file?.path ?? '');

    const customer = await prisma.customer.create({
      data: {
        name: name as string,
        email: email as string,
        phone: (phone as string) ?? '',
        website: (website as string) ?? '',
        notes: (notes as string) ?? '',
        image: imagePath,
        status: ((status as string) ?? 'Active') as Customer['status'],
        billingAddress: parseMaybeJson(billingAddress ?? {}),
        shippingAddress: parseMaybeJson(shippingAddress ?? {}),
        bankDetails: parseMaybeJson(bankDetails ?? {}),
        userId,
        // CC.1: currency the customer transacts in
        ...(customerCurrencyCode ? { currencyCode: customerCurrencyCode } : {}),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: formatCustomer(customer, ZERO_TOTALS),
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    tryUnlink(req.file?.path);
    console.error('Customer creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating customer',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function createMinimalCustomer(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      name,
      email,
      phone,
      currencyCode: rawCurrencyCode,
      billingAddress,
    } = req.body as {
      name?: string;
      email?: string;
      phone?: string;
      currencyCode?: string;
      billingAddress?: unknown;
    };

    if (!name || !email) {
      res.status(400).json({
        success: false,
        message: 'Name and Email are required',
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const existing = await prisma.customer.findFirst({
      where: { userId, email },
    });
    if (existing) {
      res.status(409).json({
        success: false,
        message: 'Customer with this email already exists',
        errors: { email: 'Customer with this email already exists' },
      });
      return;
    }

    // CC.1: use caller-supplied currencyCode or fall back to the company default.
    const customerCurrencyCode =
      (typeof rawCurrencyCode === 'string' && rawCurrencyCode ? rawCurrencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    // Normalise the optional billing address into the same JSON shape the full
    // customer create / invoice templates use (addressLine1, city, …). Only
    // persist it when at least one field is filled, so a blank section stays
    // null rather than storing an empty-string object.
    const rawAddr = (parseMaybeJson(billingAddress ?? {}) ?? {}) as Record<string, unknown>;
    const normalizedBillingAddress = {
      name: typeof rawAddr.name === 'string' && rawAddr.name ? rawAddr.name : name,
      addressLine1: typeof rawAddr.addressLine1 === 'string' ? rawAddr.addressLine1 : '',
      addressLine2: typeof rawAddr.addressLine2 === 'string' ? rawAddr.addressLine2 : '',
      city: typeof rawAddr.city === 'string' ? rawAddr.city : '',
      state: typeof rawAddr.state === 'string' ? rawAddr.state : '',
      country: typeof rawAddr.country === 'string' ? rawAddr.country : '',
      pincode: typeof rawAddr.pincode === 'string' ? rawAddr.pincode : '',
    };
    const hasBillingAddress = [
      normalizedBillingAddress.addressLine1,
      normalizedBillingAddress.addressLine2,
      normalizedBillingAddress.city,
      normalizedBillingAddress.state,
      normalizedBillingAddress.country,
      normalizedBillingAddress.pincode,
    ].some((v) => v.trim() !== '');

    const customer = await prisma.customer.create({
      data: {
        name,
        email,
        phone: phone ?? '',
        userId,
        // CC.1: currency the customer transacts in
        ...(customerCurrencyCode ? { currencyCode: customerCurrencyCode } : {}),
        ...(hasBillingAddress ? { billingAddress: normalizedBillingAddress } : {}),
      },
    });

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        currencyCode: customer.currencyCode ?? null, // CC.1
        billingAddress: customer.billingAddress ?? null,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Minimal Customer creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating customer',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCustomers(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();
    const status = req.query.status as Customer['status'] | undefined;

    const where: Prisma.CustomerWhereInput = { ...scope };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          invoicesAsBillTo: {
            where: { isDeleted: false },
            select: {
              id: true,
              TotalAmount: true,
              payments: { where: { isVoided: false }, select: { amount: true } },
            },
          },
        },
      }),
    ]);

    const formatted = rows.map((row) => {
      const invoices = row.invoicesAsBillTo;
      const invoiceTotal = invoices.reduce(
        (acc, inv) => acc + Number(inv.TotalAmount ?? 0),
        0,
      );
      const paymentTotal = invoices.reduce(
        (acc, inv) =>
          acc + inv.payments.reduce((p, payment) => p + Number(payment.amount ?? 0), 0),
        0,
      );
      const { invoicesAsBillTo: _omit, ...customerOnly } = row;
      void _omit;
      return formatCustomer(customerOnly as Customer, {
        totalInvoiceCount: invoices.length,
        invoiceTotal,
        paymentTotal,
      });
    });

    res.status(200).json({
      success: true,
      message: 'Customers fetched successfully',
      data: {
        customers: formatted,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching customers:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCustomerById(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const customer = await prisma.customer.findFirst({
      where: { ...scope, id },
    });

    if (!customer) {
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Customer retrieved successfully',
      data: formatCustomer(customer, ZERO_TOTALS),
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching customer:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching customer',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function updateCustomer(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };
    const {
      name,
      email,
      phone,
      website,
      notes,
      status,
      billingAddress,
      shippingAddress,
      bankDetails,
      profile_image_removed,
      currencyCode: rawCurrencyCode,
    } = req.body as Record<string, unknown>;

    const existing = await prisma.customer.findFirst({
      where: { ...scope, id },
    });

    if (!existing) {
      tryUnlink(req.file?.path);
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    if (email && email !== existing.email) {
      const clash = await prisma.customer.findFirst({
        where: { userId: scope.userId, email: email as string },
      });
      if (clash) {
        tryUnlink(req.file?.path);
        res.status(409).json({
          success: false,
          message: 'Another customer with this email already exists',
        });
        return;
      }
    }

    let oldImagePath = '';
    let newImage: string | null = existing.image;
    if (profile_image_removed === 'true') {
      oldImagePath = existing.image ?? '';
      newImage = '';
    } else if (req.file) {
      oldImagePath = existing.image ?? '';
      newImage = req.file.path;
    }

    const data: Prisma.CustomerUpdateInput = {
      name: name !== undefined ? (name as string) : existing.name,
      email: email !== undefined ? (email as string) : existing.email,
      phone: phone !== undefined ? ((phone as string) ?? '') : existing.phone,
      website: website !== undefined ? ((website as string) ?? '') : existing.website,
      notes: notes !== undefined ? ((notes as string) ?? '') : existing.notes,
      status:
        status !== undefined
          ? (((status as string) || 'Active') as Customer['status'])
          : existing.status,
      image: newImage,
    };

    if (billingAddress !== undefined) {
      data.billingAddress = parseMaybeJson(billingAddress ?? {});
    }
    if (shippingAddress !== undefined) {
      data.shippingAddress = parseMaybeJson(shippingAddress ?? {});
    }
    if (bankDetails !== undefined) {
      data.bankDetails = parseMaybeJson(bankDetails ?? {});
    }
    // CC.1: allow updating currencyCode (null clears it back to legacy/unset).
    if (rawCurrencyCode !== undefined) {
      (data as Record<string, unknown>)['currencyCode'] =
        typeof rawCurrencyCode === 'string' && rawCurrencyCode ? rawCurrencyCode : null;
    }

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data,
    });

    if (oldImagePath && (req.file || profile_image_removed === 'true')) {
      tryUnlink(oldImagePath);
    }

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      data: formatCustomer(updated, ZERO_TOTALS),
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    tryUnlink(req.file?.path);
    console.error('Error updating customer:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating customer',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteCustomer(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.customer.findFirst({
      where: { ...scope, id },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: { isDeleted: true },
    });

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully',
      data: { id: updated.id },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error deleting customer:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting customer',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getStatement(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    // Default range: last 90 days
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    toDate.setHours(23, 59, 59, 999);
    fromDate.setHours(0, 0, 0, 0);

    // Verify customer ownership
    const customer = await prisma.customer.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true, name: true, email: true, phone: true, billingAddress: true, shippingAddress: true, currencyCode: true },
    });
    if (!customer) {
      res.status(404).json({ success: false, message: 'Customer not found' });
      return;
    }

    // Currency-aware statement: a customer may transact in multiple currencies.
    // With no FX conversion, mixing them into one balance is meaningless, so we
    // reconcile SEPARATELY per currency. An invoice/payment's effective currency
    // falls back to the customer's currency, then the company default.
    const companyDefault = await resolveDefaultCurrencyCode();
    const custCurrency = customer.currencyCode ?? companyDefault ?? null;
    const effCur = (c: string | null | undefined): string =>
      c ?? custCurrency ?? companyDefault ?? 'UNKNOWN';

    // All invoices + payments up to toDate (split into opening vs in-period below).
    const allInvoices = await prisma.invoice.findMany({
      where: { billTo: id, userId, isDeleted: false, invoiceType: 'INVOICE', invoiceDate: { lte: toDate } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, status: true, currencyCode: true },
      orderBy: { invoiceDate: 'asc' },
    });
    const allPayments = await prisma.invoicePayment.findMany({
      where: { invoice: { billTo: id, userId, isDeleted: false }, received_on: { lte: toDate }, isVoided: false },
      select: {
        id: true,
        invoiceId: true,
        amount: true,
        received_on: true,
        notes: true,
        invoice: { select: { invoiceNumber: true, currencyCode: true } },
      },
      orderBy: { received_on: 'asc' },
    });

    interface StatementLine {
      date: Date;
      kind: 'INVOICE' | 'PAYMENT';
      reference: string;
      description: string;
      debit: number;
      credit: number;
    }
    interface Bucket { currencyCode: string; openingBalance: number; lines: StatementLine[] }
    const buckets = new Map<string, Bucket>();
    const getBucket = (cur: string): Bucket => {
      let b = buckets.get(cur);
      if (!b) { b = { currencyCode: cur, openingBalance: 0, lines: [] }; buckets.set(cur, b); }
      return b;
    };

    for (const inv of allInvoices) {
      const b = getBucket(effCur(inv.currencyCode));
      const amt = Number(inv.TotalAmount ?? 0);
      if (inv.invoiceDate < fromDate) {
        b.openingBalance += amt; // pre-period invoice raises opening balance
      } else {
        b.lines.push({
          date: inv.invoiceDate,
          kind: 'INVOICE',
          reference: inv.invoiceNumber ?? inv.id.slice(0, 8),
          description: `Invoice (${inv.status})`,
          debit: amt,
          credit: 0,
        });
      }
    }
    for (const p of allPayments) {
      const b = getBucket(effCur(p.invoice?.currencyCode));
      const amt = Number(p.amount ?? 0);
      if (p.received_on < fromDate) {
        b.openingBalance -= amt; // pre-period payment reduces opening balance
      } else {
        b.lines.push({
          date: p.received_on,
          kind: 'PAYMENT',
          reference: p.invoice?.invoiceNumber ?? p.invoiceId.slice(0, 8),
          description: p.notes || 'Payment received',
          debit: 0,
          credit: amt,
        });
      }
    }

    const byCurrency = Array.from(buckets.values()).map((b) => {
      b.lines.sort((a, c) => a.date.getTime() - c.date.getTime());
      const totalDebit = b.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = b.lines.reduce((s, l) => s + l.credit, 0);
      return {
        currencyCode: b.currencyCode,
        openingBalance: b.openingBalance,
        lines: b.lines,
        totals: { debit: totalDebit, credit: totalCredit },
        closingBalance: b.openingBalance + totalDebit - totalCredit,
      };
    });
    // Customer's own currency first, then alphabetical.
    byCurrency.sort((a, c) => {
      if (a.currencyCode === custCurrency) return -1;
      if (c.currencyCode === custCurrency) return 1;
      return a.currencyCode.localeCompare(c.currencyCode);
    });
    // Always return at least the customer's currency section (empty), so the UI has context.
    if (byCurrency.length === 0 && custCurrency) {
      byCurrency.push({ currencyCode: custCurrency, openingBalance: 0, lines: [], totals: { debit: 0, credit: 0 }, closingBalance: 0 });
    }

    res.json({
      success: true,
      data: {
        customer,
        period: { from: fromDate, to: toDate },
        byCurrency,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getStatement error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate statement' });
  }
}

// =============================================================================
// CSV Import (slice E.4)
// =============================================================================

interface CustomerImportPreviewRow {
  rowIndex: number;
  name: string;
  email: string;
  phone: string;
  website?: string;
  notes?: string;
  error?: string;
}

export async function customerImportPreview(req: Request, res: Response): Promise<void> {
  try {
    requireUserId(req);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ success: false, message: 'CSV file required' });
      return;
    }

    const csvText = file.buffer.toString('utf-8');
    let records: Array<Record<string, string>>;
    try {
      records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;
    } catch (e) {
      res.status(400).json({
        success: false,
        message: `CSV parse error: ${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const previewRows: CustomerImportPreviewRow[] = records.map((row, idx) => {
      const name = row.name || row.Name || row.customer_name || '';
      const email = row.email || row.Email || '';
      const phone = row.phone || row.Phone || row.mobile || '';
      const errors: string[] = [];
      if (!name.trim()) errors.push('name required');
      if (!email.trim()) errors.push('email required');
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('invalid email');
      if (!phone.trim()) errors.push('phone required');

      return {
        rowIndex: idx,
        name,
        email,
        phone,
        website: row.website || row.Website || '',
        notes: row.notes || row.Notes || '',
        ...(errors.length ? { error: errors.join('; ') } : {}),
      };
    });

    res.json({
      success: true,
      data: {
        previewRows,
        validCount: previewRows.filter((r) => !r.error).length,
        invalidCount: previewRows.filter((r) => r.error).length,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('customerImportPreview error:', err);
    res.status(500).json({ success: false, message: 'Failed to parse CSV' });
  }
}

export async function customerImportConfirm(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      rows?: Array<{
        name: string;
        email: string;
        phone: string;
        website?: string;
        notes?: string;
      }>;
    };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      res.status(400).json({ success: false, message: 'Non-empty rows[] required' });
      return;
    }

    const results: Array<{
      rowIndex: number;
      status: 'CREATED' | 'SKIPPED';
      id?: string;
      error?: string;
    }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      try {
        const existing = await prisma.customer.findFirst({
          where: { userId, email: row.email, isDeleted: false },
        });
        if (existing) {
          results.push({ rowIndex: i, status: 'SKIPPED', error: 'email already exists' });
          continue;
        }
        const created = await prisma.customer.create({
          data: {
            userId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            website: row.website ?? '',
            notes: row.notes ?? '',
            status: 'Active',
          },
        });
        results.push({ rowIndex: i, status: 'CREATED', id: created.id });
      } catch (e) {
        results.push({
          rowIndex: i,
          status: 'SKIPPED',
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Processed ${body.rows.length} rows`,
      data: {
        results,
        createdCount: results.filter((r) => r.status === 'CREATED').length,
        skippedCount: results.filter((r) => r.status === 'SKIPPED').length,
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('customerImportConfirm error:', err);
    res.status(500).json({ success: false, message: 'Failed to import customers' });
  }
}

// CommonJS interop for legacy JS routes that still use module-alias requires.
module.exports = {
  createCustomer,
  createMinimalCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getStatement,
  customerImportPreview,
  customerImportConfirm,
};
module.exports.createCustomer = createCustomer;
module.exports.createMinimalCustomer = createMinimalCustomer;
module.exports.getCustomers = getCustomers;
module.exports.getCustomerById = getCustomerById;
module.exports.updateCustomer = updateCustomer;
module.exports.deleteCustomer = deleteCustomer;
module.exports.getStatement = getStatement;
module.exports.customerImportPreview = customerImportPreview;
module.exports.customerImportConfirm = customerImportConfirm;
