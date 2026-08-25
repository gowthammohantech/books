import type { Expense } from '@prisma/client';

import { prisma } from './prisma';
import { getNextRecurringDate } from './recurringInvoiceRunner';
import {
  nextDocumentNumber,
  withDocumentNumberRetry,
  type NumberingModel,
} from './documentNumbering';
import { postExpense, type PostingTx } from './ledger/ledgerPosting';
import { resolveBankGlAccountId } from './ledger/bankAccount';

interface CloneResult {
  source: Expense;
  newExpenseId: string;
  /** The source's next due date AFTER this run (null once ended) — lets the
   *  catch-up loop decide whether more missed periods remain. */
  nextRecurringDate: Date | null;
}

/** Midnight (local) today — the cron's notion of "due as of now". */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function runRecurringForExpense(expenseId: string): Promise<CloneResult> {
  // expenseId is a GLOBAL @unique column, so numbering must be tenant-safe and
  // collision-recovering. withDocumentNumberRetry re-runs the WHOLE owning
  // transaction on a P2002 for expenseId (a poisoned interactive tx can't be
  // retried in place — see lib/documentNumbering.ts header).
  return await withDocumentNumberRetry('expenseId', () =>
    prisma.$transaction(async (tx) => {
      const source = await tx.expense.findFirst({
        where: { id: expenseId, isRecurring: true, isDeleted: false },
      });
      if (!source) throw new Error('SOURCE_NOT_FOUND');
      if (source.stopped) throw new Error('SOURCE_STOPPED');

      // Date the generated expense on the SCHEDULED date (the due date recorded in
      // nextRecurringDate), NOT the cron RUN day. Advancing from the scheduled date
      // keeps the series on its original anchor day so a missed cron run cannot
      // permanently shift the schedule. Legacy rows with no nextRecurringDate fall
      // back to today.
      const scheduledDate = source.nextRecurringDate ?? startOfToday();

      // expenseId is @unique; copying the parent's value verbatim throws P2002 and
      // aborts the transaction (no child). Regenerate a fresh, tenant-scoped
      // EXP-NNNNNN via the shared numbering helper (P1 tenant-safe series).
      const newExpenseNumber = await nextDocumentNumber({
        model: tx.expense as unknown as NumberingModel,
        field: 'expenseId',
        prefix: 'EXP-',
        tenantWhere: { userId: source.userId },
      });

      const {
        id: _id,
        createdAt: _ca,
        updatedAt: _ua,
        expenseId: _eid,
        parentExpense: _pe,
        lastRecurringDate: _lr,
        nextRecurringDate: _nr,
        ...rest
      } = source;

      const created = await tx.expense.create({
        data: {
          ...rest,
          expenseId: newExpenseNumber,
          parentExpense: source.id,
          expenseDate: scheduledDate,
          isRecurring: false,
          lastRecurringDate: null,
          nextRecurringDate: null,
        },
      });

      const advancedNext = getNextRecurringDate(scheduledDate, source);
      await tx.expense.update({
        where: { id: source.id },
        data: {
          lastRecurringDate: scheduledDate,
          nextRecurringDate: advancedNext,
        },
      });

    // GL posting: mirror controllers/expenseController.postExpenseLedger so
    // recurring expenses hit the ledger just like manually-created ones. Crons
    // previously skipped this, leaving recurring expense off the GL P&L. gatedPost
    // is a no-op until the ledger is live and is idempotent per (Expense,
    // created.id, 'recorded') so a re-run cannot double-post.
    const mapping = await tx.ledgerAccountMapping.findFirst({
      where: { userId: created.userId, roleKey: 'PURCHASES' },
      select: { accountId: true },
    });
    if (mapping?.accountId) {
      const taxAmount = created.tax != null ? String(created.tax) : '0';

      let paymentModeSlug: string | null = null;
      if (created.sourceType === 'BANK' && created.paymentModeId) {
        const pmDoc = await tx.paymentMode.findUnique({
          where: { id: created.paymentModeId },
          select: { slug: true },
        });
        paymentModeSlug = pmDoc?.slug ?? null;
      }

      // Reimbursable expenses owe the employee via the 9250 account.
      let employeePayableAccountId: string | undefined;
      if ((created.sourceType as string) === 'EMPLOYEE_PAID') {
        const owed = await tx.account.findFirst({
          where: { userId: created.userId, code: '9250', isDeleted: false },
          select: { id: true },
        });
        if (!owed?.id) {
          throw new Error(
            'Amounts Owed to Employees account (9250) is not initialized for this company.',
          );
        }
        employeePayableAccountId = owed.id;
      }

      const bankGlAccountId =
        created.sourceType === 'BANK'
          ? await resolveBankGlAccountId(tx as never, created.bankId ?? null)
          : null;

      await postExpense(tx as unknown as PostingTx, {
        userId: created.userId,
        expenseId: created.id,
        date: created.expenseDate,
        total: String(created.amount),
        tax: taxAmount,
        expenseAccountId: mapping.accountId,
        sourceType: created.sourceType ?? null,
        paymentModeSlug,
        bankGlAccountId,
        ...(employeePayableAccountId ? { employeePayableAccountId } : {}),
        ...(created.costCenterId !== undefined ? { costCenterId: created.costCenterId } : {}),
        ...(created.projectId !== undefined ? { projectId: created.projectId } : {}),
        ...(created.currencyCode ? { currencyCode: created.currencyCode } : {}),
        ...(created.exchangeRate != null ? { exchangeRate: created.exchangeRate } : {}),
      });
    }

      return { source, newExpenseId: created.id, nextRecurringDate: advancedNext };
    }),
  );
}

// Bound the per-expense catch-up loop so a corrupt cadence (advance that never
// crosses `today`) can't spin forever. 480 ≈ 40 years of monthly runs — far
// beyond any real backlog, yet finite.
const MAX_CATCHUP_PER_EXPENSE = 480;

export async function runDueRecurringExpenses(): Promise<{
  processed: number;
  successes: string[];
  failures: Array<{ id: string; error: string }>;
}> {
  const today = startOfToday();

  const due = await prisma.expense.findMany({
    where: {
      isRecurring: true,
      isDeleted: false,
      stopped: false,
      parentExpense: null,
      nextRecurringDate: { lte: today },
      OR: [
        { neverExpire: true },
        { endsOn: null },
        { endsOn: { gte: today } },
      ],
    },
    select: { id: true, referenceNo: true },
  });

  const successes: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  for (const exp of due) {
    try {
      // Catch up EVERY missed period deterministically, one occurrence per
      // scheduled date, until the next due date lands on/after today (or the
      // schedule ends). Advancing from the scheduled date (inside
      // runRecurringForExpense) means missed periods are generated separately —
      // never collapsed into a single occurrence, never permanently drifted.
      let runs = 0;
      for (;;) {
        const out = await runRecurringForExpense(exp.id);
        successes.push(`${exp.referenceNo ?? exp.id} → ${out.newExpenseId}`);
        runs += 1;
        if (
          out.nextRecurringDate == null ||
          out.nextRecurringDate.getTime() > today.getTime() ||
          runs >= MAX_CATCHUP_PER_EXPENSE
        ) {
          break;
        }
      }
    } catch (err) {
      failures.push({ id: exp.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { processed: due.length, successes, failures };
}
