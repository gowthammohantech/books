/**
 * controllers/payrollController.ts
 *
 * Payroll Profile CRUD — My Money Phase 2 (Task 6)
 *
 * Routes:
 *   GET    /admin/payroll/profiles        — listProfiles
 *   POST   /admin/payroll/profiles        — createProfile
 *   PUT    /admin/payroll/profiles/:id    — updateProfile
 *   DELETE /admin/payroll/profiles/:id    — deleteProfile
 *
 * Tenant scoping: PayrollProfile.tenantId = the company owner id (tenantId).
 * The `employeeUserId` must reference a User that is either the owner
 * themselves OR a staff member (ownerId == tenantId).
 */

import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireTenantId } from '../lib/tenantScope';
import { taxYearByLabel } from '../lib/payroll/taxYear';
import { postPayRunLineAccrual, reversePayRunLineAccrual } from '../lib/payroll/payRunPosting';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ProfileInput {
  employeeUserId?: string;
  defaultGross?: number | null;
  payFrequency?: string;
  isActive?: boolean;
}

export function validateProfileInput(
  p: ProfileInput,
): { ok: true } | { ok: false; errors: Record<string, string> } {
  if (!p.employeeUserId) {
    return { ok: false, errors: { employeeUserId: 'Employee is required.' } };
  }
  if (p.defaultGross != null && Number(p.defaultGross) < 0) {
    return { ok: false, errors: { defaultGross: 'Default gross must be zero or positive.' } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Confirm the given `employeeUserId` is a User that belongs to this tenant
 * (i.e. the owner themselves OR a staff member whose ownerId == tenantId).
 */
async function assertTenantEmployee(tenantId: string, employeeUserId: string): Promise<boolean> {
  // PayrollProfile model is in the schema (Task 1) but the local generated
  // Prisma client is stale. Use the same cast-through-unknown pattern that
  // myMoneyController uses for fields added after the last `prisma generate`.
  const person = await (prisma.user.findFirst as (args: unknown) => Promise<{ id: string } | null>)({
    where: {
      id: employeeUserId,
      isDeleted: false,
      OR: [
        { id: tenantId },          // owner themselves
        { ownerId: tenantId },     // staff member of this tenant
      ],
    },
    select: { id: true },
  });
  return !!person;
}

// Shorthand for the Prisma payrollProfile delegate (client is stale; cast once)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payrollProfileDelegate = (prisma as unknown as Record<string, any>).payrollProfile as {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};

// Stale-client delegates for payRun / payRunLine (same pattern)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payRunDelegate = (prisma as unknown as Record<string, any>).payRun as {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payRunLineDelegate = (prisma as unknown as Record<string, any>).payRunLine as {
  findMany: (args: unknown) => Promise<unknown[]>;
  deleteMany: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

export interface DeductionLine { label: string; amount: number }

export function computeLineTotals(
  gross: number,
  deductionLines: DeductionLine[],
): { deductions: number; net: number } {
  const deductions = deductionLines.reduce((s, d) => s + Number(d.amount || 0), 0);
  if (deductions > gross) throw Object.assign(new Error('Deductions exceed gross pay.'), { status: 400 });
  return { deductions, net: gross - deductions };
}

async function resolvePayrollAccountIds(
  tenantId: string,
): Promise<{ wages: string; netPayable: string; deductionsPayable: string }> {
  const accts = await prisma.account.findMany({
    where: { tenantId, code: { in: ['9230', '9260', '9270'] }, isDeleted: false },
    select: { id: true, code: true },
  });
  const byCode = Object.fromEntries(accts.map((a) => [a.code, a.id]));
  if (!byCode['9230'] || !byCode['9260'] || !byCode['9270']) {
    throw new Error(
      'Payroll accounts (9230/9260/9270) are not initialized. Run the payroll-accounts backfill or prisma import.',
    );
  }
  return { wages: byCode['9230'], netPayable: byCode['9260'], deductionsPayable: byCode['9270'] };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function listProfiles(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const profiles = await payrollProfileDelegate.findMany({
      where: { tenantId, isDeleted: false },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: profiles });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function createProfile(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const body = req.body as ProfileInput;

    const v = validateProfileInput(body);
    if (!v.ok) {
      res.status(400).json({ success: false, message: 'Validation failed.', errors: v.errors });
      return;
    }

    if (!(await assertTenantEmployee(tenantId, body.employeeUserId as string))) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { employeeUserId: 'Employee not found in your workspace.' },
      });
      return;
    }

    // Unique active profile guard
    const existing = await payrollProfileDelegate.findFirst({
      where: { tenantId, employeeUserId: body.employeeUserId, isDeleted: false },
      select: { id: true },
    });
    if (existing) {
      res.status(409).json({ success: false, message: 'A payroll profile already exists for this employee.' });
      return;
    }

    const profile = await payrollProfileDelegate.create({
      data: {
        tenantId,
        employeeUserId: body.employeeUserId as string,
        ...(body.defaultGross != null ? { defaultGross: String(body.defaultGross) } : {}),
        ...(body.payFrequency !== undefined ? { payFrequency: body.payFrequency } : {}),
        isActive: body.isActive ?? true,
      },
    });
    res.status(201).json({ success: true, data: profile });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params;
    const body = req.body as ProfileInput;

    if (body.defaultGross != null && Number(body.defaultGross) < 0) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { defaultGross: 'Default gross must be zero or positive.' },
      });
      return;
    }

    const existing = await payrollProfileDelegate.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    const profile = await payrollProfileDelegate.update({
      where: { id },
      data: {
        ...(body.defaultGross !== undefined
          ? { defaultGross: body.defaultGross != null ? String(body.defaultGross) : null }
          : {}),
        ...(body.payFrequency !== undefined ? { payFrequency: body.payFrequency } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    res.json({ success: true, data: profile });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function deleteProfile(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { id } = req.params;

    const existing = await payrollProfileDelegate.findFirst({
      where: { id, tenantId, isDeleted: false },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Profile not found.' });
      return;
    }

    await payrollProfileDelegate.update({
      where: { id },
      data: { isDeleted: true },
    });
    res.json({ success: true });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Pay Run handlers (Task 7)
// ---------------------------------------------------------------------------

export async function listRuns(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const taxYear = (req.query.taxYear as string) || undefined;
    const runs = await payRunDelegate.findMany({
      where: { tenantId, isDeleted: false, ...(taxYear ? { taxYearLabel: taxYear } : {}) },
      include: { lines: { select: { net: true } } },
      orderBy: [{ taxYearLabel: 'desc' }, { taxMonth: 'desc' }],
    });
    res.json({ success: true, data: runs });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function getRun(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const run = await payRunDelegate.findFirst({
      where: { id: req.params.id, tenantId, isDeleted: false },
      include: {
        lines: {
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!run) {
      res.status(404).json({ success: false, message: 'Pay run not found.' });
      return;
    }
    res.json({ success: true, data: run });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function createRun(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const { taxYearLabel, taxMonth } = req.body as { taxYearLabel?: string; taxMonth?: number };

    if (!taxYearLabel || !taxMonth || taxMonth < 1 || taxMonth > 12) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { taxMonth: 'taxYearLabel and taxMonth (1-12) are required.' },
      });
      return;
    }

    let ty;
    try {
      ty = taxYearByLabel(taxYearLabel);
    } catch {
      res.status(400).json({ success: false, message: 'Invalid tax year label.' });
      return;
    }

    // Reject duplicate non-VOID run for same (tenantId, taxYearLabel, taxMonth)
    const dup = await payRunDelegate.findFirst({
      where: { tenantId, taxYearLabel, taxMonth, isDeleted: false, status: { not: 'VOID' } },
      select: { id: true },
    });
    if (dup) {
      res.status(409).json({ success: false, message: 'A pay run already exists for this period.' });
      return;
    }

    // UK tax-month boundaries:
    //   month m: start = 6 Apr + (m-1) months, end = 5th of the next month
    //   e.g. month 1: 6 Apr → 5 May; month 2: 6 May → 5 Jun; ...
    const tyStartYear = ty.start.getUTCFullYear();
    const tyStartMonth = ty.start.getUTCMonth(); // 3 = April (0-indexed)
    const periodStart = new Date(Date.UTC(tyStartYear, tyStartMonth + (taxMonth - 1), 6));
    const periodEnd = new Date(Date.UTC(tyStartYear, tyStartMonth + taxMonth, 5));

    // Pre-fill DRAFT lines from ACTIVE profiles
    const profiles = await payrollProfileDelegate.findMany({
      where: { tenantId, isActive: true, isDeleted: false },
      select: { employeeUserId: true, defaultGross: true },
    }) as Array<{ employeeUserId: string; defaultGross: string | null }>;

    let run: Record<string, unknown>;
    try {
      run = await payRunDelegate.create({
        data: {
          tenantId,
          taxYearLabel,
          taxMonth,
          periodStart,
          periodEnd,
          status: 'DRAFT',
          lines: {
            create: profiles.map((p) => {
              const gross = p.defaultGross != null ? Number(p.defaultGross) : 0;
              return {
                employeeUserId: p.employeeUserId,
                gross: String(gross) as never,
                deductions: '0' as never,
                net: String(gross) as never,
                deductionLines: [] as never,
              };
            }),
          },
        },
        include: { lines: true },
      });
    } catch (createErr) {
      if ((createErr as { code?: string }).code === 'P2002') {
        res.status(409).json({ success: false, message: 'A pay run already exists for this period.' });
        return;
      }
      throw createErr;
    }
    res.status(201).json({ success: true, data: run });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function updateRun(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const run = await payRunDelegate.findFirst({
      where: { id: req.params.id, tenantId, isDeleted: false },
      select: { id: true, status: true },
    }) as { id: string; status: string } | null;

    if (!run) {
      res.status(404).json({ success: false, message: 'Pay run not found.' });
      return;
    }
    if (run.status !== 'DRAFT') {
      res.status(409).json({ success: false, message: 'Only DRAFT runs can be edited.' });
      return;
    }

    const lines = (
      req.body as {
        lines?: {
          employeeUserId: string;
          gross: number;
          deductionLines?: DeductionLine[];
          note?: string;
        }[];
      }
    ).lines || [];

    // M7b — validate each line's employee belongs to this tenant before writing
    for (const line of lines) {
      if (!(await assertTenantEmployee(tenantId, line.employeeUserId))) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { employeeUserId: 'One or more line employees are not in your workspace.' },
        });
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as unknown as any).$transaction(async (tx: Record<string, any>) => {
      await tx.payRunLine.deleteMany({ where: { payRunId: run.id } });
      for (const l of lines) {
        const { deductions, net } = computeLineTotals(Number(l.gross), l.deductionLines || []);
        await tx.payRunLine.create({
          data: {
            payRunId: run.id,
            employeeUserId: l.employeeUserId,
            gross: String(l.gross) as never,
            deductions: String(deductions) as never,
            net: String(net) as never,
            deductionLines: (l.deductionLines || []) as never,
            note: l.note ?? null,
          },
        });
      }
    });

    const updated = await payRunDelegate.findFirst({ where: { id: run.id }, include: { lines: true } });
    res.json({ success: true, data: updated });
  } catch (err) {
    // computeLineTotals throws a tagged 400 when deductions > gross
    if ((err as { status?: number }).status === 400) {
      res.status(400).json({ success: false, message: (err as Error).message });
      return;
    }
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function finalizeRun(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const run = await payRunDelegate.findFirst({
      where: { id: req.params.id, tenantId, isDeleted: false },
      include: { lines: true },
    }) as {
      id: string;
      status: string;
      periodEnd: Date;
      lines: Array<{ id: string; gross: unknown; net: unknown; deductions: unknown }>;
    } | null;

    if (!run) {
      res.status(404).json({ success: false, message: 'Pay run not found.' });
      return;
    }
    if (run.status !== 'DRAFT') {
      res.status(409).json({ success: false, message: 'Only DRAFT runs can be finalized.' });
      return;
    }
    if (run.lines.length === 0) {
      res.status(400).json({ success: false, message: 'Cannot finalize an empty run.' });
      return;
    }

    let accts;
    try {
      accts = await resolvePayrollAccountIds(tenantId);
    } catch (e) {
      res.status(400).json({ success: false, message: (e as Error).message });
      return;
    }

    // U7 — wrap transaction to catch P2002 (concurrent finalize race) → 409
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as unknown as any).$transaction(async (tx: Record<string, any>) => {
        for (const line of run.lines) {
          await postPayRunLineAccrual(tx as never, {
            tenantId,
            lineId: line.id,
            date: run.periodEnd,
            gross: String(line.gross),
            net: String(line.net),
            deductions: String(line.deductions),
            wagesAccountId: accts.wages,
            netPayableAccountId: accts.netPayable,
            deductionsPayableAccountId: accts.deductionsPayable,
          });
        }
        await tx.payRun.update({ where: { id: run.id }, data: { status: 'FINALIZED', finalizedAt: new Date() } });
      });
    } catch (txErr) {
      if ((txErr as { code?: string }).code === 'P2002') {
        res.status(409).json({ success: false, message: 'This pay run is already being finalized or has been finalized.' });
        return;
      }
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}

export async function voidRun(req: Request, res: Response): Promise<void> {
  try {
    const tenantId = requireTenantId(req);
    const run = await payRunDelegate.findFirst({
      where: { id: req.params.id, tenantId, isDeleted: false },
      include: { lines: { select: { id: true, employeeUserId: true } } },
    }) as {
      id: string;
      status: string;
      taxYearLabel: string;
      lines: Array<{ id: string; employeeUserId: string }>;
    } | null;

    if (!run) {
      res.status(404).json({ success: false, message: 'Pay run not found.' });
      return;
    }
    if (run.status !== 'FINALIZED') {
      res.status(409).json({ success: false, message: 'Only FINALIZED runs can be voided.' });
      return;
    }

    // Void guard: use the full tax-year window (safer than period-only)
    // to catch any payroll_settlement posted to these employees within the year.
    const employeeIds = run.lines.map((l) => l.employeeUserId);
    const ty = taxYearByLabel(run.taxYearLabel);
    const settlement = await (prisma.bankTransaction as unknown as {
      findFirst: (args: unknown) => Promise<{ id: string } | null>;
    }).findFirst({
      where: {
        isDeleted: false,
        userPaymentReason: 'payroll_settlement',
        payToUserId: { in: employeeIds },
        transactionDate: { gte: ty.start, lte: ty.end },
      },
      select: { id: true },
    });

    if (settlement) {
      res.status(409).json({
        success: false,
        message: 'Cannot void: a salary settlement has been posted for this period. Reverse the settlement first.',
      });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as unknown as any).$transaction(async (tx: Record<string, any>) => {
      for (const line of run.lines) {
        await reversePayRunLineAccrual(tx as never, { tenantId, lineId: line.id });
      }
      await tx.payRun.update({ where: { id: run.id }, data: { status: 'VOID', voidedAt: new Date() } });
    });

    res.json({ success: true });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ success: false, message: (err as Error).message });
  }
}
