import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireTenantId, UnauthorizedError } from '../lib/tenantScope';
import {
  collectCostCentreIds,
  assertCostCentresExist,
  UnknownCostCentreError,
} from '../lib/lineDimensions';

export interface ManualJeLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  /** Profit centre for this leg. Without it there is no way to book a
   *  period-end adjustment to a department, which leaves the departmental P&L
   *  uncorrectable. */
  costCenterId?: string | null;
  projectId?: string | null;
}

export interface ManualJeBaseLine extends ManualJeLineInput {
  baseDebit: Prisma.Decimal;
  baseCredit: Prisma.Decimal;
}

/**
 * Derive the BASE-currency columns for a manual journal entry.
 *
 * Every report (Trial Balance, P&L, Balance Sheet) aggregates baseDebit/baseCredit;
 * before this, manual JEs left them at the column default (0) and were silently
 * dropped from the books. base = transaction amount × exchangeRate, mirroring how
 * lib/ledger/buildLines derives base amounts (baseAmount = amount * rate). For a
 * base-currency entry rate=1 so baseDebit=debit / baseCredit=credit.
 */
export function buildManualJeBaseLines(
  lines: ManualJeLineInput[],
  exchangeRate: Prisma.Decimal,
): ManualJeBaseLine[] {
  return lines.map((l) => ({
    ...l,
    baseDebit: new Prisma.Decimal(Number(l.debit ?? 0)).times(exchangeRate),
    baseCredit: new Prisma.Decimal(Number(l.credit ?? 0)).times(exchangeRate),
  }));
}

/** Normalize a raw exchange-rate input to a positive Decimal (default 1 for base currency). */
export function resolveManualJeRate(raw: unknown): Prisma.Decimal {
  return raw != null && raw !== '' && !Number.isNaN(Number(raw)) && Number(raw) > 0
    ? new Prisma.Decimal(Number(raw))
    : new Prisma.Decimal(1);
}

async function generateEntryNumber(): Promise<string> {
  const last = await prisma.journalEntry.findFirst({
    where: { entryNumber: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { entryNumber: true },
  });
  let lastNum = 0;
  if (last?.entryNumber) {
    const m = last.entryNumber.match(/\d+$/);
    if (m) lastNum = parseInt(m[0], 10);
  }
  return `JE-${String(lastNum + 1).padStart(6, '0')}`;
}

export async function list(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)));

    const where: Prisma.JournalEntryWhereInput = { tenantId, isDeleted: false };
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    // Report drill-down (Trial Balance / Budget Variance): show only entries that
    // touch a given account.
    const accountId = req.query.accountId as string | undefined;
    if (accountId) {
      where.lines = { some: { accountId } };
    }
    if (from || to) {
      where.entryDate = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: { include: { account: { select: { id: true, code: true, name: true } } } },
        },
        orderBy: { entryDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        journalEntries: rows.map((e) => ({
          id: e.id,
          entryNumber: e.entryNumber,
          entryDate: e.entryDate,
          description: e.description,
          reference: e.reference,
          totalDebit: e.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0),
          totalCredit: e.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0),
          lineCount: e.lines.length,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('journalEntry list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list journal entries' });
  }
}

export async function getById(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const row = await prisma.journalEntry.findFirst({
      where: { id, tenantId, isDeleted: false },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true, accountType: true } } } } },
    });
    if (!row) {
      res.status(404).json({ success: false, message: 'Journal entry not found' });
      return;
    }
    res.json({ success: true, data: { journalEntry: { ...row } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('journalEntry getById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load journal entry' });
  }
}

export async function create(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const body = req.body as {
      entryDate?: string;
      description?: string;
      reference?: string;
      currencyCode?: string;
      exchangeRate?: number | string;
      lines?: Array<{
        accountId: string;
        debit?: number;
        credit?: number;
        description?: string;
        costCenterId?: string | null;
        projectId?: string | null;
      }>;
    };

    // Functional-currency conversion. Manual JEs are entered in transaction
    // amounts (debit/credit); reports aggregate the BASE columns, so every line
    // MUST carry baseDebit/baseCredit. For a base-currency entry the rate is 1
    // (baseDebit=debit, baseCredit=credit). For a foreign-currency entry, the
    // base amount is the transaction amount times the supplied FX rate — mirrors
    // how lib/ledger/buildLines derives base amounts (baseAmount = amount * rate).
    const exchangeRate = resolveManualJeRate(body.exchangeRate);
    const isForeign =
      typeof body.currencyCode === 'string' &&
      body.currencyCode.trim().length === 3 &&
      body.currencyCode.trim().toUpperCase() !== 'BASE';
    const currencyCode = isForeign ? body.currencyCode!.trim().toUpperCase() : null;

    if (!Array.isArray(body.lines) || body.lines.length < 2) {
      res.status(400).json({ success: false, message: 'At least 2 lines required' });
      return;
    }

    const totalDebit = body.lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCredit = body.lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      res.status(400).json({ success: false, message: `Debits (${totalDebit}) must equal credits (${totalCredit})` });
      return;
    }

    // Compute the base-currency columns up front and enforce the GL invariant on
    // them too. Per-line rounding (Decimal *) can leave a residual that the
    // looser txn-amount check above would miss; reports tie out only if
    // SUM(baseDebit) === SUM(baseCredit), so guard it here.
    const rate = exchangeRate;
    const baseLines = buildManualJeBaseLines(body.lines, rate);
    const baseDebitTotal = baseLines.reduce(
      (s, l) => s.add(l.baseDebit),
      new Prisma.Decimal(0),
    );
    const baseCreditTotal = baseLines.reduce(
      (s, l) => s.add(l.baseCredit),
      new Prisma.Decimal(0),
    );
    if (!baseDebitTotal.equals(baseCreditTotal)) {
      res.status(400).json({
        success: false,
        message: `Base-currency debits (${baseDebitTotal.toFixed(4)}) must equal base credits (${baseCreditTotal.toFixed(4)})`,
      });
      return;
    }

    // Verify all accounts belong to user
    const accountIds = body.lines.map((l) => l.accountId);
    const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, tenantId, isDeleted: false } });
    if (accounts.length !== new Set(accountIds).size) {
      res.status(400).json({ success: false, message: 'One or more accounts not found' });
      return;
    }

    // Verify every referenced profit centre belongs to this tenant and is live.
    // JournalLine.costCenterId is `onDelete: SetNull`, so a bad id would not be
    // rejected by the FK — it would just land in the ledger unnoticed.
    try {
      await assertCostCentresExist(
        prisma,
        tenantId,
        collectCostCentreIds(null, body.lines.map((l) => ({ costCenterId: l.costCenterId }))),
      );
    } catch (centreErr) {
      if (centreErr instanceof UnknownCostCentreError) {
        res.status(400).json({ success: false, message: centreErr.message });
        return;
      }
      throw centreErr;
    }

    const entryNumber = await generateEntryNumber();
    const created = await prisma.journalEntry.create({
      data: {
        tenantId,
        entryNumber,
        entryDate: body.entryDate ? new Date(body.entryDate) : new Date(),
        description: body.description ?? null,
        reference: body.reference ?? null,
        lines: {
          create: baseLines.map((l) => ({
            tenantId: tenantId,
            accountId: l.accountId,
            debit: new Prisma.Decimal(Number(l.debit ?? 0)),
            credit: new Prisma.Decimal(Number(l.credit ?? 0)),
            // BASE columns drive every report (TB/P&L/BS). Populate them so manual
            // JEs are no longer silently dropped (defaulted to 0).
            baseDebit: l.baseDebit,
            baseCredit: l.baseCredit,
            currencyCode,
            exchangeRate: rate,
            description: l.description ?? null,
            costCenterId: l.costCenterId ?? null,
            projectId: l.projectId ?? null,
          })),
        },
      },
      include: { lines: true },
    });

    res.status(201).json({ success: true, message: 'Journal entry created', data: { journalEntry: { ...created } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('journalEntry create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create journal entry' });
  }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.journalEntry.findFirst({ where: { id, tenantId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Journal entry not found' });
      return;
    }
    await prisma.journalEntry.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Journal entry deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('journalEntry remove error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete journal entry' });
  }
}

