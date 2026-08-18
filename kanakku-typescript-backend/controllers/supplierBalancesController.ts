// controllers/supplierBalancesController.ts
//
// Supplier Balances report — a supplier-wise (Contact-with-purchases) view of
// Accounts Payable activity. AP is a credit-balance liability, so columns are
// labelled to make the convention unambiguous:
//
//   Credit (Bills)            = Σ Purchase.totalAmount        (increases payable)
//   Debit  (Payments&Returns) = Σ SupplierPayment.amount
//                             + Σ DebitNote.totalAmount        (reduces payable)
//   Balance Due               = Credit − Debit                 (outstanding payable)
//
// Only suppliers with ANY AP activity (a purchase OR supplier payment OR debit
// note) are included. A TOTALS row is returned alongside the per-supplier rows.
//
// All figures are Decimal-safe (Prisma.Decimal). Tenant-scoped via requireUserId.
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
import { toCsv, type CsvColumn } from '../lib/export/csv';

const ZERO = (): Prisma.Decimal => new Prisma.Decimal(0);

interface Bucket {
  contactId: string;
  firstName?: string | null;
  lastName?: string | null;
  organisation?: string | null;
  bills: Prisma.Decimal; // credit
  paymentsAndReturns: Prisma.Decimal; // debit
}

interface SupplierBalanceRow {
  contactId: string;
  name: string;
  bills: string;
  paymentsAndReturns: string;
  balance: string;
}

/**
 * Aggregate AP activity per supplier (Contact) for the current tenant.
 * Returns rows sorted by Balance Due (desc) plus a totals bucket.
 */
async function buildSupplierBalances(
  userId: string,
): Promise<{ rows: SupplierBalanceRow[]; totals: { bills: string; paymentsAndReturns: string; balance: string } }> {
  const buckets = new Map<string, Bucket>();

  const ensure = (
    contactId: string,
    identity?: { firstName?: string | null; lastName?: string | null; organisation?: string | null } | null,
  ): Bucket => {
    let b = buckets.get(contactId);
    if (!b) {
      b = {
        contactId,
        firstName: identity?.firstName,
        lastName: identity?.lastName,
        organisation: identity?.organisation,
        bills: ZERO(),
        paymentsAndReturns: ZERO(),
      };
      buckets.set(contactId, b);
    } else if (identity && !b.organisation && !b.firstName && !b.lastName) {
      b.firstName = identity.firstName;
      b.lastName = identity.lastName;
      b.organisation = identity.organisation;
    }
    return b;
  };

  // Credit — bills. Only POSTED bills increase the payable:
  //  - exclude status 'new' (draft) and 'cancelled';
  //  - exclude approvalStatus PENDING/REJECTED — those are not posted to the GL
  //    (posting runs only for NOT_REQUIRED / APPROVED), so including them would
  //    over-state payables versus the AP control account.
  const purchases = await prisma.purchase.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { notIn: ['new', 'cancelled'] },
      approvalStatus: { in: ['NOT_REQUIRED', 'APPROVED'] },
      contactId: { not: null },
    },
    select: {
      contactId: true,
      totalAmount: true,
      contact: { select: { firstName: true, lastName: true, organisation: true } },
    },
  });
  for (const p of purchases) {
    if (!p.contactId) continue;
    const b = ensure(p.contactId, p.contact);
    b.bills = b.bills.plus(p.totalAmount ?? 0);
  }

  // Debit — supplier payments. SupplierPayment has no userId column; it is
  // tenant-scoped through its parent purchase. Void via isVoided / isDeleted.
  const payments = await prisma.supplierPayment.findMany({
    where: {
      isVoided: false,
      isDeleted: false,
      contactId: { not: null },
      purchase: { is: { userId } },
    },
    select: {
      contactId: true,
      paidAmount: true,
      contact: { select: { firstName: true, lastName: true, organisation: true } },
    },
  });
  for (const pay of payments) {
    if (!pay.contactId) continue;
    const b = ensure(pay.contactId, pay.contact);
    // paidAmount is the cash actually disbursed; `amount` may carry the full
    // bill total from the legacy status-flip default and would over-state the
    // debit side.
    b.paymentsAndReturns = b.paymentsAndReturns.plus(pay.paidAmount ?? 0);
  }

  // Debit — purchase returns (debit notes). Only POSTED DNs reduce the payable.
  // Exclude soft-deleted, 'cancelled' (reversed) AND 'new' (draft): a draft DN
  // does NOT post to the AP GL (the posted-gate mirrors the bill filter above),
  // so counting it here would under-state payables versus the AP control account.
  const debitNotes = await prisma.debitNote.findMany({
    where: {
      userId,
      isDeleted: false,
      status: { notIn: ['new', 'cancelled'] },
      contactId: { not: null },
    },
    select: {
      contactId: true,
      totalAmount: true,
      contact: { select: { firstName: true, lastName: true, organisation: true } },
    },
  });
  for (const dn of debitNotes) {
    if (!dn.contactId) continue;
    const b = ensure(dn.contactId, dn.contact);
    b.paymentsAndReturns = b.paymentsAndReturns.plus(dn.totalAmount ?? 0);
  }

  let runBills = ZERO();
  let runDebit = ZERO();

  const rows: (SupplierBalanceRow & { _balance: Prisma.Decimal })[] = [];
  for (const b of buckets.values()) {
    const balance = b.bills.minus(b.paymentsAndReturns);
    runBills = runBills.plus(b.bills);
    runDebit = runDebit.plus(b.paymentsAndReturns);
    rows.push({
      contactId: b.contactId,
      name: resolveDisplayName(b),
      bills: b.bills.toString(),
      paymentsAndReturns: b.paymentsAndReturns.toString(),
      balance: balance.toString(),
      _balance: balance,
    });
  }

  // Sort by Balance Due desc, then by name asc for stability.
  rows.sort((a, b) => {
    const cmp = b._balance.comparedTo(a._balance);
    if (cmp !== 0) return cmp;
    return a.name.localeCompare(b.name);
  });

  const cleanRows: SupplierBalanceRow[] = rows.map(({ _balance, ...r }) => r);

  return {
    rows: cleanRows,
    totals: {
      bills: runBills.toString(),
      paymentsAndReturns: runDebit.toString(),
      balance: runBills.minus(runDebit).toString(),
    },
  };
}

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'name', header: 'Supplier' },
  { key: 'bills', header: 'Credit (Bills)' },
  { key: 'paymentsAndReturns', header: 'Debit (Payments & Returns)' },
  { key: 'balance', header: 'Balance Due' },
];

function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/**
 * GET /reports/supplier-balances
 * GET /reports/supplier-balances.csv         (CSV variant)
 * GET /reports/supplier-balances?format=csv  (CSV variant)
 */
export async function supplierBalances(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { rows, totals } = await buildSupplierBalances(userId);

    const wantsCsv =
      req.query.format === 'csv' || /\.csv$/i.test(req.path) || /\.csv$/i.test(req.originalUrl.split('?')[0]);

    if (wantsCsv) {
      const csvRows: Record<string, unknown>[] = [
        ...rows.map((r) => ({ ...r })),
        {
          name: 'TOTAL',
          bills: totals.bills,
          paymentsAndReturns: totals.paymentsAndReturns,
          balance: totals.balance,
        },
      ];
      sendCsv(res, 'supplier-balances.csv', toCsv(csvRows, CSV_COLUMNS));
      return;
    }

    res.json({ success: true, data: { rows, totals } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    console.error('Error building supplier balances report:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to build supplier balances report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
