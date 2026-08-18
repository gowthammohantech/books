import type { Request, Response } from 'express';
import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma';
import { requireUserId } from '../lib/tenantScope';
import { validateContactIdentity, resolveDisplayName } from '../lib/contacts/contactIdentity';
import { parseVatNumber, isEuMember } from '../lib/euVat';
import { validateVatOnline } from '../lib/vies';
import { contactViewWhere, type ContactView } from '../lib/contacts/contactRole';
import { buildContactSummary } from '../lib/contacts/contactSummary';
import { getAccountCreditBalance, type AccountCreditBalanceDb } from '../lib/contacts/accountCreditBalance';

// Untyped delegate — Contact may be absent from a stale local client (typed after prisma generate).
const cdb = (): { contact: Record<string, (a: unknown) => Promise<unknown>> } =>
  prisma as unknown as { contact: Record<string, (a: unknown) => Promise<unknown>> };

export interface ContactBody {
  firstName?: string | null; lastName?: string | null; organisation?: string | null;
  email?: string | null; billingEmail?: string | null; telephone?: string | null; mobile?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; addressLine3?: string | null;
  town?: string | null; region?: string | null; postcode?: string | null; countryId?: string | null;
  defaultPaymentTermDays?: number | null; useContactEmailSettings?: boolean; invoiceSequencePrefix?: string | null;
  defaultTaxTreatment?: string; vatRegNumber?: string | null; vatNumber?: string | null; country?: string | null; gstin?: string | null; invoiceLanguage?: string | null;
  currencyCode?: string | null; bankDetails?: unknown; notes?: string | null; image?: string | null;
  status?: string; showNameOnInvoice?: boolean;
}

export function validateContactBody(b: ContactBody): { ok: true } | { ok: false; errors: Record<string, string> } {
  const id = validateContactIdentity(b);
  if (!id.ok) return { ok: false, errors: { identity: id.error } };
  if (b.defaultPaymentTermDays != null && Number(b.defaultPaymentTermDays) < 0) {
    return { ok: false, errors: { defaultPaymentTermDays: 'Payment term must be zero or more days.' } };
  }
  // EU/UK VAT number is optional; when provided it must be structurally valid.
  if (typeof b.vatNumber === 'string' && b.vatNumber.trim() !== '' && !parseVatNumber(b.vatNumber).valid) {
    return { ok: false, errors: { vatNumber: 'Invalid VAT number format.' } };
  }
  return { ok: true };
}

const VALID_VIEWS: ContactView[] = ['all-active', 'clients', 'suppliers', 'clients-open-invoices', 'suppliers-open-bills', 'hidden', 'all'];

export async function listContacts(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const view = (req.query.view as ContactView) || 'all-active';
    const safeView = VALID_VIEWS.includes(view) ? view : 'all-active';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const q = (req.query.q as string | undefined)?.trim();
    const where: Record<string, unknown> = contactViewWhere(userId, safeView);
    if (q) {
      const searchOr = [
        { organisation: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
      // The view filter (e.g. suppliers) may itself use an `OR` (relation
      // checks). Don't overwrite it — AND the search OR with the view OR so the
      // search stays scoped to the selected view.
      if (where['OR']) {
        where['AND'] = [{ OR: where['OR'] }, { OR: searchOr }];
        delete where['OR'];
      } else {
        where['OR'] = searchOr;
      }
    }
    const [rows, total] = await Promise.all([
      cdb().contact.findMany({ where, orderBy: { organisation: 'asc' }, skip: (page - 1) * pageSize, take: pageSize } as never) as Promise<Record<string, unknown>[]>,
      cdb().contact.count({ where } as never) as Promise<number>,
    ]);
    const data = rows.map((c) => ({ ...c, displayName: resolveDisplayName(c as never) }));
    res.json({ success: true, data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getContact(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const c = (await cdb().contact.findFirst({ where: { id: req.params.id, userId, isDeleted: false } } as never)) as Record<string, unknown> | null;
    if (!c) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }
    res.json({ success: true, data: { ...c, displayName: resolveDisplayName(c as never) } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

function dataFromBody(userId: string, b: ContactBody): Record<string, unknown> {
  return {
    userId,
    firstName: b.firstName ?? null, lastName: b.lastName ?? null, organisation: b.organisation ?? null,
    showNameOnInvoice: b.showNameOnInvoice ?? false,
    email: b.email ?? null, billingEmail: b.billingEmail ?? null, telephone: b.telephone ?? null, mobile: b.mobile ?? null,
    addressLine1: b.addressLine1 ?? null, addressLine2: b.addressLine2 ?? null, addressLine3: b.addressLine3 ?? null,
    town: b.town ?? null, region: b.region ?? null, postcode: b.postcode ?? null, countryId: b.countryId ?? null,
    defaultPaymentTermDays: b.defaultPaymentTermDays ?? null, useContactEmailSettings: b.useContactEmailSettings ?? false,
    invoiceSequencePrefix: b.invoiceSequencePrefix ?? null,
    defaultTaxTreatment: (['STANDARD','ZERO_RATED','EXEMPT','REVERSE_CHARGE','OUT_OF_SCOPE'].includes(b.defaultTaxTreatment as string) ? b.defaultTaxTreatment : 'STANDARD'), vatRegNumber: b.vatRegNumber ?? null, vatNumber: b.vatNumber ?? null, country: b.country ?? null, gstin: b.gstin ?? null, invoiceLanguage: b.invoiceLanguage ?? null,
    currencyCode: b.currencyCode ?? null, bankDetails: b.bankDetails ?? null, notes: b.notes ?? null, image: b.image ?? null,
    status: b.status === 'HIDDEN' ? 'HIDDEN' : 'ACTIVE',
  };
}

/**
 * OPTIONAL online EU VIES VAT-number validation for a contact save.
 *
 * Tenant-gated + fail-open + non-blocking:
 *   - Runs ONLY when the tenant's CompanySettings.viesValidationEnabled is true
 *     AND the contact carries an EU VAT number (GB/non-EU and empty VAT skip it).
 *   - When it runs, it sets `data.viesValid` + `data.viesCheckedAt` (audit of the
 *     last check). A VIES "invalid" flags the contact but never blocks the save.
 *   - On any error/timeout/non-2xx the VIES helper itself fails open; we only
 *     persist the audit flag when an authoritative (`checked`) answer was obtained.
 *   - When VIES is disabled or the VAT is non-EU/empty, the audit fields are left
 *     untouched (null on create / preserved on update).
 *
 * Mutates and returns `data`. Never throws.
 */
async function applyViesValidation(
  userId: string,
  vatNumber: string | null | undefined,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vat = (vatNumber ?? '').trim();
  if (vat === '') return data;

  const parsed = parseVatNumber(vat);
  // GB (post-Brexit) and non-EU prefixes are not covered by VIES — skip the call.
  if (!isEuMember(parsed.country)) return data;

  // OFF BY DEFAULT: the outbound VIES call only fires when this tenant opted in.
  const settings = await prisma.companySettings.findFirst({
    where: { userId },
    select: { viesValidationEnabled: true },
  });
  if (!settings?.viesValidationEnabled) return data;

  // Fail-open: validateVatOnline never throws; it returns source:'offline' on any
  // network/timeout/non-2xx. We only persist the audit when VIES answered.
  const result = await validateVatOnline(vat);
  if (result.checked) {
    data.viesValid = result.valid;
    data.viesCheckedAt = new Date();
  }
  return data;
}

export async function createContact(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const b = req.body as ContactBody;
    const v = validateContactBody(b);
    if (!v.ok) { res.status(400).json({ success: false, message: 'Validation failed.', errors: v.errors }); return; }
    const data = await applyViesValidation(userId, b.vatNumber, dataFromBody(userId, b));
    const c = await cdb().contact.create({ data } as never);
    res.status(201).json({ success: true, data: c });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function createMinimalContact(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const b = req.body as ContactBody;
    const v = validateContactBody(b);
    if (!v.ok) { res.status(400).json({ success: false, message: 'Validation failed.', errors: v.errors }); return; }
    const data = await applyViesValidation(userId, b.vatNumber, dataFromBody(userId, b));
    const c = await cdb().contact.create({ data } as never);
    res.status(201).json({ success: true, data: c });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function updateContact(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const existing = (await cdb().contact.findFirst({ where: { id: req.params.id, userId, isDeleted: false } } as never)) as { id: string } | null;
    if (!existing) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }
    const b = req.body as ContactBody;
    const v = validateContactBody(b);
    if (!v.ok) { res.status(400).json({ success: false, message: 'Validation failed.', errors: v.errors }); return; }
    const data = await applyViesValidation(userId, b.vatNumber, dataFromBody(userId, b));
    const c = await cdb().contact.update({ where: { id: req.params.id }, data } as never);
    res.json({ success: true, data: c });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function deleteContact(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const existing = (await cdb().contact.findFirst({ where: { id: req.params.id, userId, isDeleted: false } } as never)) as { id: string } | null;
    if (!existing) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }
    await cdb().contact.update({ where: { id: req.params.id }, data: { isDeleted: true } } as never);
    res.json({ success: true, message: 'Contact deleted successfully.' });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

// =============================================================================
// Analytics endpoints (Task 3)
// =============================================================================

export async function getContactSummary(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = req.params.id;
    const c = (await cdb().contact.findFirst({ where: { id, userId, isDeleted: false } } as never)) as Record<string, unknown> | null;
    if (!c) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }

    // InvoicePayment date field is `received_on`; link to contact via invoice.contactId.
    const invPays = (await prisma.invoicePayment.findMany({
      where: { invoice: { contactId: id } as never, isVoided: false },
      select: { amount: true, received_on: true },
    } as never)) as { amount: unknown; received_on: Date }[];

    // SupplierPayment date field is `paymentDate`. Resolve via the PURCHASE's
    // contactId (matches getContactStatement) rather than the payment's own
    // contactId — many payments never had their own contactId backfilled, so
    // filtering on it directly silently dropped them here while the Statement
    // of Account (which already resolves through purchase.contactId) counted
    // them, producing exactly the "summary vs statement disagree" symptom.
    const supPays = (await prisma.supplierPayment.findMany({
      where: { purchase: { contactId: id } as never, isVoided: false, isDeleted: false },
      select: { amount: true, paymentDate: true },
    } as never)) as { amount: unknown; paymentDate: Date }[];

    const rows = [
      ...invPays.map((p) => ({ date: p.received_on ?? new Date(), received: Number(p.amount), paid: 0 })),
      ...supPays.map((p) => ({ date: p.paymentDate ?? new Date(), received: 0, paid: Number(p.amount) })),
    ];
    const summary = buildContactSummary(rows, new Date());

    // theyOwe / youOwe must reflect OUTSTANDING documents, not just payments.
    // Receivable = invoiced (excl. drafts/cancelled) − payments received.
    // Payable = the sum of each purchase's stored outstanding balanceAmount.
    const invoices = (await prisma.invoice.findMany({
      where: { contactId: id, isDeleted: false, status: { notIn: ['DRAFT', 'CANCELLED'] } } as never,
      select: { TotalAmount: true },
    } as never)) as { TotalAmount: unknown }[];
    // Exclude 'new' (draft/unapproved, no bill posted to the GL yet) as well as
    // 'cancelled' — matches getContactStatement's bills query and the AP-aging
    // guard (an unapproved purchase has no AP credit, so it isn't real payable
    // yet; counting it here would overstate "You Owe" vs both of those).
    const purchases = (await prisma.purchase.findMany({
      where: { contactId: id, isDeleted: false, status: { notIn: ['new', 'cancelled'] } } as never,
      select: { balanceAmount: true },
    } as never)) as { balanceAmount: unknown }[];
    // Debit notes (purchase returns) reduce the payable — net them so this matches
    // the Supplier Balances report (bills − payments − returns). Purchase
    // balanceAmount = bills − payments, so payable = Σ balanceAmount − Σ debit notes.
    const debitNotes = (await prisma.debitNote.findMany({
      where: { contactId: id, isDeleted: false } as never,
      select: { totalAmount: true },
    } as never)) as { totalAmount: unknown }[];
    const invoiced = invoices.reduce((s, i) => s + Number(i.TotalAmount ?? 0), 0);
    const outstandingPayable = purchases.reduce((s, p) => s + Number(p.balanceAmount ?? 0), 0);
    const debitNoteTotal = debitNotes.reduce((s, d) => s + Number(d.totalAmount ?? 0), 0);
    summary.theyOwe = Math.max(invoiced - summary.totalReceived, 0);
    summary.youOwe = Math.max(outstandingPayable - debitNoteTotal, 0);

    // Per-contact Account Credit: always derived (never stored), see
    // lib/contacts/accountCreditBalance.ts.
    const accountCreditBalance = Number(await getAccountCreditBalance(prisma as unknown as AccountCreditBalanceDb, { userId, contactId: id as string }));

    res.json({ success: true, data: { contact: { ...c, displayName: resolveDisplayName(c as never) }, ...summary, accountCreditBalance } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getContactStatement(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = req.params.id;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const c = (await cdb().contact.findFirst({ where: { id, userId, isDeleted: false } } as never)) as Record<string, unknown> | null;
    if (!c) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }

    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    toDate.setHours(23, 59, 59, 999);
    fromDate.setHours(0, 0, 0, 0);

    const contactCurrency = (c.currencyCode as string | null) ?? null;

    // Resolve company default currency for fallback
    const defaultCurrencyRow = await prisma.currency.findFirst({ where: { isDefault: true, isDeleted: false }, select: { code: true } });
    const companyDefault = defaultCurrencyRow?.code ?? null;
    const effCur = (code: string | null | undefined): string => code ?? contactCurrency ?? companyDefault ?? 'UNKNOWN';

    // All invoices for this contact up to toDate
    const allInvoices = await prisma.invoice.findMany({
      where: { contactId: id, userId, isDeleted: false, invoiceType: 'INVOICE' as never, invoiceDate: { lte: toDate } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, status: true, currencyCode: true },
      orderBy: { invoiceDate: 'asc' },
    } as never) as { id: string; invoiceNumber: string | null; invoiceDate: Date; TotalAmount: unknown; status: string; currencyCode: string | null }[];

    // All payments on those invoices up to toDate
    const allPayments = (await prisma.invoicePayment.findMany({
      where: { invoice: { contactId: id, userId, isDeleted: false } as never, received_on: { lte: toDate }, isVoided: false },
      select: {
        id: true, invoiceId: true, amount: true, received_on: true, notes: true,
        invoice: { select: { invoiceNumber: true, currencyCode: true } },
      },
      orderBy: { received_on: 'asc' },
    } as never)) as unknown as { id: string; invoiceId: string; amount: unknown; received_on: Date; notes: string | null; invoice: { invoiceNumber: string | null; currencyCode: string | null } | null }[];

    // Supplier side (AP). A Contact is unified — the same record can be both a
    // customer (AR, above) and a supplier (AP, here). Without this, a pure
    // supplier's statement is empty and their partial payments never show.
    // Bills (purchases) up to toDate for this contact — exclude draft/cancelled
    // to match how bills are counted elsewhere (supplierBalancesController).
    const allPurchases = await prisma.purchase.findMany({
      where: { contactId: id, userId, isDeleted: false, status: { notIn: ['new', 'cancelled'] }, purchaseDate: { lte: toDate } },
      select: { id: true, purchaseId: true, purchaseDate: true, totalAmount: true, status: true, currencyCode: true },
      orderBy: { purchaseDate: 'asc' },
    } as never) as { id: string; purchaseId: string | null; purchaseDate: Date; totalAmount: unknown; status: string; currencyCode: string | null }[];

    // Supplier payments against those purchases up to toDate. SupplierPayment
    // has no userId column; tenant scope comes through the parent purchase.
    const allSupplierPayments = (await prisma.supplierPayment.findMany({
      where: { purchase: { contactId: id, userId, isDeleted: false } as never, isVoided: false, isDeleted: false, paymentDate: { lte: toDate } },
      select: {
        id: true, purchaseId: true, paidAmount: true, paymentDate: true, notes: true, referenceNumber: true,
        purchase: { select: { purchaseId: true, currencyCode: true } },
      },
      orderBy: { paymentDate: 'asc' },
    } as never)) as unknown as { id: string; purchaseId: string; paidAmount: unknown; paymentDate: Date; notes: string | null; referenceNumber: string | null; purchase: { purchaseId: string | null; currencyCode: string | null } | null }[];

    // Purchase debit notes (returns) up to toDate — reduce what we owe. Same
    // posted-gate as bills so the statement agrees with the AP control account.
    const allPurchaseDebitNotes = await prisma.debitNote.findMany({
      where: { contactId: id, userId, isDeleted: false, status: { notIn: ['new', 'cancelled'] }, debitNoteDate: { lte: toDate } },
      select: { id: true, debitNoteId: true, debitNoteDate: true, totalAmount: true, status: true, currencyCode: true },
      orderBy: { debitNoteDate: 'asc' },
    } as never) as { id: string; debitNoteId: string | null; debitNoteDate: Date; totalAmount: unknown; status: string | null; currencyCode: string | null }[];

    interface StatementLine { date: Date; kind: 'INVOICE' | 'PAYMENT' | 'BILL' | 'SUPPLIER_PAYMENT' | 'DEBIT_NOTE'; reference: string; description: string; debit: number; credit: number }
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
        b.openingBalance += amt;
      } else {
        b.lines.push({ date: inv.invoiceDate, kind: 'INVOICE', reference: inv.invoiceNumber ?? inv.id.slice(0, 8), description: `Invoice (${inv.status})`, debit: amt, credit: 0 });
      }
    }
    for (const p of allPayments) {
      const b = getBucket(effCur(p.invoice?.currencyCode));
      const amt = Number(p.amount ?? 0);
      if (p.received_on < fromDate) {
        b.openingBalance -= amt;
      } else {
        b.lines.push({ date: p.received_on, kind: 'PAYMENT', reference: p.invoice?.invoiceNumber ?? p.invoiceId.slice(0, 8), description: p.notes || 'Payment received', debit: 0, credit: amt });
      }
    }

    // Supplier bill — increases what we owe, so it's a CREDIT against the one
    // unified balance (debit = in our favour, credit = in their favour).
    for (const pur of allPurchases) {
      const b = getBucket(effCur(pur.currencyCode));
      const amt = Number(pur.totalAmount ?? 0);
      if (pur.purchaseDate < fromDate) {
        b.openingBalance -= amt;
      } else {
        b.lines.push({ date: pur.purchaseDate, kind: 'BILL', reference: pur.purchaseId ?? pur.id.slice(0, 8), description: `Bill (${pur.status})`, debit: 0, credit: amt });
      }
    }
    // Supplier payment (we pay them) — a DEBIT, pulling the balance back toward
    // zero. Uses paidAmount (the actual cash disbursed), consistent with the
    // rest of the codebase (see supplierBalancesController).
    for (const sp of allSupplierPayments) {
      const b = getBucket(effCur(sp.purchase?.currencyCode));
      const amt = Number(sp.paidAmount ?? 0);
      if (sp.paymentDate < fromDate) {
        b.openingBalance += amt;
      } else {
        b.lines.push({ date: sp.paymentDate, kind: 'SUPPLIER_PAYMENT', reference: sp.purchase?.purchaseId ?? sp.purchaseId.slice(0, 8), description: sp.notes || 'Payment made', debit: amt, credit: 0 });
      }
    }
    // Purchase debit note (return to supplier) — reduces what we owe, a DEBIT.
    for (const dn of allPurchaseDebitNotes) {
      const b = getBucket(effCur(dn.currencyCode));
      const amt = Number(dn.totalAmount ?? 0);
      if (dn.debitNoteDate < fromDate) {
        b.openingBalance += amt;
      } else {
        b.lines.push({ date: dn.debitNoteDate, kind: 'DEBIT_NOTE', reference: dn.debitNoteId ?? dn.id.slice(0, 8), description: `Debit note (${dn.status ?? 'issued'})`, debit: amt, credit: 0 });
      }
    }

    const byCurrency = Array.from(buckets.values()).map((b) => {
      b.lines.sort((a, z) => a.date.getTime() - z.date.getTime());
      const totalDebit = b.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = b.lines.reduce((s, l) => s + l.credit, 0);
      return { currencyCode: b.currencyCode, openingBalance: b.openingBalance, lines: b.lines, totals: { debit: totalDebit, credit: totalCredit }, closingBalance: b.openingBalance + totalDebit - totalCredit };
    });
    byCurrency.sort((a, z) => {
      if (a.currencyCode === contactCurrency) return -1;
      if (z.currencyCode === contactCurrency) return 1;
      return a.currencyCode.localeCompare(z.currencyCode);
    });
    if (byCurrency.length === 0 && contactCurrency) {
      byCurrency.push({ currencyCode: contactCurrency, openingBalance: 0, lines: [], totals: { debit: 0, credit: 0 }, closingBalance: 0 });
    }

    res.json({ success: true, data: { contact: { ...c, displayName: resolveDisplayName(c as never) }, period: { from: fromDate, to: toDate }, byCurrency } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getContactHistory(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = req.params.id;
    const c = (await cdb().contact.findFirst({ where: { id, userId, isDeleted: false } } as never)) as Record<string, unknown> | null;
    if (!c) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }

    // Gather documents linked to this contact via contactId
    const [invoices, quotations, purchases, debitNotes] = await Promise.all([
      prisma.invoice.findMany({
        where: { contactId: id, userId, isDeleted: false },
        select: { id: true, invoiceNumber: true, invoiceDate: true, TotalAmount: true, isRecurring: true, referenceNo: true, notes: true, currencyCode: true, status: true },
        orderBy: { invoiceDate: 'desc' },
      } as never) as Promise<{ id: string; invoiceNumber: string | null; invoiceDate: Date; TotalAmount: unknown; isRecurring: boolean; referenceNo: string | null; notes: string | null; currencyCode: string | null; status: string }[]>,
      prisma.quotation.findMany({
        where: { contactId: id, userId, isDeleted: false },
        select: { id: true, quotationId: true, quotationDate: true, TotalAmount: true, referenceNo: true, notes: true, currencyCode: true, status: true },
        orderBy: { quotationDate: 'desc' },
      } as never) as Promise<{ id: string; quotationId: string | null; quotationDate: Date; TotalAmount: unknown; referenceNo: string | null; notes: string | null; currencyCode: string | null; status: string }[]>,
      prisma.purchase.findMany({
        where: { contactId: id, userId, isDeleted: false },
        select: { id: true, purchaseId: true, purchaseDate: true, totalAmount: true, referenceNo: true, notes: true, currencyCode: true, status: true },
        orderBy: { purchaseDate: 'desc' },
      } as never) as Promise<{ id: string; purchaseId: string | null; purchaseDate: Date; totalAmount: unknown; referenceNo: string | null; notes: string | null; currencyCode: string | null; status: string }[]>,
      prisma.debitNote.findMany({
        where: { contactId: id, userId, isDeleted: false },
        select: { id: true, debitNoteId: true, debitNoteDate: true, totalAmount: true, referenceNo: true, notes: true, currencyCode: true, status: true },
        orderBy: { debitNoteDate: 'desc' },
      } as never) as Promise<{ id: string; debitNoteId: string | null; debitNoteDate: Date; totalAmount: unknown; referenceNo: string | null; notes: string | null; currencyCode: string | null; status: string | null }[]>,
    ]);

    // Each history item carries the fields the contact-detail tabs render: a
    // `reference` (the document number), a `description` (referenceNo/notes),
    // the document `currencyCode`, and a `status`. `type` values are aligned
    // with the frontend tab filters (INVOICE / RECURRING_INVOICE / BILL /
    // ESTIMATE); recurring invoices are Invoice rows with isRecurring=true.
    const items: {
      id: string;
      type: string;
      reference: string | null;
      description: string | null;
      date: Date;
      amount: number;
      currencyCode: string | null;
      status: string | null;
    }[] = [
      ...invoices.map((d) => ({
        id: d.id,
        type: d.isRecurring ? 'RECURRING_INVOICE' : 'INVOICE',
        reference: d.invoiceNumber,
        description: d.referenceNo || d.notes || null,
        date: d.invoiceDate,
        amount: Number(d.TotalAmount ?? 0),
        currencyCode: d.currencyCode ?? null,
        status: d.status ?? null,
      })),
      ...quotations.map((d) => ({
        id: d.id,
        type: 'ESTIMATE',
        reference: d.quotationId,
        description: d.referenceNo || d.notes || null,
        date: d.quotationDate,
        amount: Number(d.TotalAmount ?? 0),
        currencyCode: d.currencyCode ?? null,
        status: d.status ?? null,
      })),
      ...purchases.map((d) => ({
        id: d.id,
        type: 'BILL',
        reference: d.purchaseId,
        description: d.referenceNo || d.notes || null,
        date: d.purchaseDate,
        amount: Number(d.totalAmount ?? 0),
        currencyCode: d.currencyCode ?? null,
        status: d.status ?? null,
      })),
      ...debitNotes.map((d) => ({
        id: d.id,
        type: 'DEBIT_NOTE',
        reference: d.debitNoteId,
        description: d.referenceNo || d.notes || null,
        date: d.debitNoteDate,
        amount: Number(d.totalAmount ?? 0),
        currencyCode: d.currencyCode ?? null,
        status: d.status ?? null,
      })),
    ];
    items.sort((a, b) => b.date.getTime() - a.date.getTime());

    res.json({ success: true, data: { contact: { ...c, displayName: resolveDisplayName(c as never) }, items } });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getContactVCard(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = req.params.id;
    const c = (await cdb().contact.findFirst({ where: { id, userId, isDeleted: false } } as never)) as Record<string, unknown> | null;
    if (!c) { res.status(404).json({ success: false, message: 'Contact not found.' }); return; }

    const displayName = resolveDisplayName(c as never);
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push(`FN:${displayName}`);
    if (c.organisation) lines.push(`ORG:${String(c.organisation)}`);
    if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${String(c.email)}`);
    if (c.billingEmail) lines.push(`EMAIL;TYPE=INTERNET,BILLING:${String(c.billingEmail)}`);
    if (c.telephone) lines.push(`TEL;TYPE=WORK,VOICE:${String(c.telephone)}`);
    if (c.mobile) lines.push(`TEL;TYPE=CELL:${String(c.mobile)}`);

    // ADR field: ;;street;city;region;postcode;country (country placeholder — no name lookup here)
    const adrParts = [
      '', // PO Box
      '', // Extended address
      [c.addressLine1, c.addressLine2, c.addressLine3].filter(Boolean).join(', '),
      c.town ?? '',
      c.region ?? '',
      c.postcode ?? '',
      c.countryId ?? '', // ISO id used as-is
    ].map((v) => String(v ?? ''));
    lines.push(`ADR;TYPE=WORK:${adrParts.join(';')}`);

    lines.push('END:VCARD');
    const vcard = lines.join('\r\n') + '\r\n';

    const slug = displayName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'contact';
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.vcf"`);
    res.send(vcard);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

// =============================================================================
// CSV Import / Export (Task 9)
// =============================================================================

interface ContactImportPreviewRow {
  rowIndex: number;
  organisation: string;
  firstName: string;
  lastName: string;
  email: string;
  telephone: string;
  town: string;
  region: string;
  postcode: string;
  currencyCode: string;
  error?: string;
}

export async function contactImportPreview(req: Request, res: Response): Promise<void> {
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

    const previewRows: ContactImportPreviewRow[] = records.map((row, idx) => {
      const organisation = row.organisation || row.Organisation || row.company || row.Company || '';
      const firstName = row.firstName || row.first_name || row.FirstName || '';
      const lastName = row.lastName || row.last_name || row.LastName || '';
      const email = row.email || row.Email || '';
      const telephone = row.telephone || row.Telephone || row.phone || row.Phone || '';
      const town = row.town || row.Town || row.city || row.City || '';
      const region = row.region || row.Region || row.state || row.State || '';
      const postcode = row.postcode || row.Postcode || row.zip || row.Zip || '';
      const currencyCode = row.currencyCode || row.currency_code || row.Currency || '';

      const errors: string[] = [];
      // Identity rule: organisation, OR both firstName + lastName
      const idResult = validateContactIdentity({ organisation, firstName, lastName });
      if (!idResult.ok) errors.push(idResult.error);

      return {
        rowIndex: idx,
        organisation,
        firstName,
        lastName,
        email,
        telephone,
        town,
        region,
        postcode,
        currencyCode,
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
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function contactImportConfirm(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      rows?: Array<{
        organisation?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        telephone?: string;
        town?: string;
        region?: string;
        postcode?: string;
        currencyCode?: string;
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
      // Validate identity rule per row
      const idResult = validateContactIdentity({
        organisation: row.organisation,
        firstName: row.firstName,
        lastName: row.lastName,
      });
      if (!idResult.ok) {
        results.push({ rowIndex: i, status: 'SKIPPED', error: idResult.error });
        continue;
      }
      try {
        const c = (await cdb().contact.create({
          data: {
            userId,
            organisation: row.organisation ?? null,
            firstName: row.firstName ?? null,
            lastName: row.lastName ?? null,
            email: row.email ?? null,
            telephone: row.telephone ?? null,
            town: row.town ?? null,
            region: row.region ?? null,
            postcode: row.postcode ?? null,
            currencyCode: row.currencyCode ?? null,
            status: 'ACTIVE',
          },
        } as never)) as { id: string };
        results.push({ rowIndex: i, status: 'CREATED', id: c.id });
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
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getContactsExport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = (await cdb().contact.findMany({
      where: { userId, isDeleted: false },
      orderBy: { organisation: 'asc' },
      select: {
        id: true,
        organisation: true,
        firstName: true,
        lastName: true,
        email: true,
        billingEmail: true,
        telephone: true,
        mobile: true,
        addressLine1: true,
        addressLine2: true,
        addressLine3: true,
        town: true,
        region: true,
        postcode: true,
        currencyCode: true,
        status: true,
        createdAt: true,
      },
    } as never)) as Record<string, unknown>[];

    const headers = [
      'id', 'organisation', 'firstName', 'lastName', 'email', 'billingEmail',
      'telephone', 'mobile', 'addressLine1', 'addressLine2', 'addressLine3',
      'town', 'region', 'postcode', 'currencyCode', 'status', 'createdAt',
    ];

    const escapeCsv = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines: string[] = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
    }
    const csv = lines.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}
