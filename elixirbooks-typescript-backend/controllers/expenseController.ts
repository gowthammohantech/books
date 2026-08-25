// controllers/expenseController.ts
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  Expense,
  ExpensePaymentStatus,
  ExpenseSourceType,
  BankTransactionType,
  PettyCashTransactionType,
  RecurrenceFrequency,
  RecurrenceCustomIntervalType,
} from '@prisma/client';
import { validationResult } from 'express-validator';

import { prisma } from '../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';
import { handleLedgerError } from '../lib/httpErrors';
import { runRecurringForExpense } from '../lib/recurringExpenseRunner';
import {
  postExpense,
  reverseDocument,
  voidDocument,
  type PostingTx,
} from '../lib/ledger/ledgerPosting';
import { resolveBankGlAccountId } from '../lib/ledger/bankAccount';
import { explainedBankFields } from '../lib/moneyFlow/explainedBankFields';
import { initialApprovalStatus, shouldPostOnCreate } from '../lib/ledger/approvals';
import { shouldPost } from '../lib/ledger/postingGate';
import { resolveExpenseFxRate, type FxGuardDb } from '../lib/ledger/expenseFxGuard';
import { toBaseAmount } from '../lib/ledger/money';

type Tx = Prisma.TransactionClient;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function toDecimal(value: unknown, fallback = 0): Prisma.Decimal {
  return new Prisma.Decimal(
    typeof value === 'number' || typeof value === 'string' ? value : fallback,
  );
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}/`;
}

interface CustomFieldInput {
  fieldId: string;
  value?: unknown;
}

function parseCustomFields(input: unknown): CustomFieldInput[] {
  if (!input) return [];
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? (parsed as CustomFieldInput[]) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(input) ? (input as CustomFieldInput[]) : [];
}

async function generateNextExpenseId(
  tx: Tx,
  prefix = 'EXP-',
): Promise<string> {
  const last = await tx.expense.findFirst({
    where: { expenseId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { expenseId: true },
  });

  let lastNumber = 0;
  if (last?.expenseId) {
    const match = last.expenseId.match(/\d+$/);
    if (match) lastNumber = parseInt(match[0], 10);
  }

  return `${prefix}${String(lastNumber + 1).padStart(6, '0')}`;
}

// =============================================================================
// postExpenseLedger — shared helper used by createExpense (approvalsEnabled=false)
//                     AND approveExpense (approvalsEnabled=true).
// =============================================================================

async function postExpenseLedger(
  tx: Tx,
  expense: { id: string; expenseDate: Date | null; amount: Prisma.Decimal; tax?: Prisma.Decimal | null; sourceType: ExpenseSourceType | null; paymentModeId: string | null; bankId?: string | null; paidByUserId?: string | null; userId: string; costCenterId?: string | null; projectId?: string | null; currencyCode?: string | null; exchangeRate?: Prisma.Decimal | null },
  userId: string,
): Promise<void> {
  const mapping = await tx.ledgerAccountMapping.findFirst({
    where: { userId, roleKey: 'PURCHASES' },
    select: { accountId: true },
  });
  if (!mapping?.accountId) return;

  // Post the expense's real tax (defaults to 0 for legacy/no-tax expenses).
  const taxAmount = expense.tax != null ? String(expense.tax) : '0';

  let paymentModeSlug: string | null = null;
  if (expense.sourceType === 'BANK' && expense.paymentModeId) {
    const pmDoc = await tx.paymentMode.findUnique({
      where: { id: expense.paymentModeId },
      select: { slug: true },
    });
    paymentModeSlug = pmDoc?.slug ?? null;
  }

  // Reimbursable: resolve the per-owner 9250 "Amounts Owed to Employees" account by code.
  let employeePayableAccountId: string | undefined;
  if ((expense.sourceType as string) === 'EMPLOYEE_PAID') {
    const owed = await tx.account.findFirst({
      where: { userId, code: '9250', isDeleted: false },
      select: { id: true },
    });
    if (!owed?.id) {
      throw new Error('Amounts Owed to Employees account (9250) is not initialized for this company. Run prisma:import or the 9250 backfill.');
    }
    employeePayableAccountId = owed.id;
  }

  // Per-bank GL sub-account for the BANK leg (A1). Null when not a bank-paid
  // expense or the bank is un-backfilled → falls back to the shared BANK role.
  const bankGlAccountId = expense.sourceType === 'BANK'
    ? await resolveBankGlAccountId(tx as never, expense.bankId ?? null)
    : null;

  await postExpense(tx as unknown as PostingTx, {
    userId,
    expenseId: expense.id,
    date: expense.expenseDate ?? new Date(),
    total: String(expense.amount),
    tax: taxAmount,
    expenseAccountId: mapping.accountId,
    sourceType: expense.sourceType ?? null,
    paymentModeSlug,
    bankGlAccountId,
    ...(employeePayableAccountId ? { employeePayableAccountId } : {}),
    // P3.3: pass dims if present on the document
    ...(expense.costCenterId !== undefined ? { costCenterId: expense.costCenterId } : {}),
    ...(expense.projectId !== undefined ? { projectId: expense.projectId } : {}),
    // per-expense currency
    ...(expense.currencyCode ? { currencyCode: expense.currencyCode } : {}),
    ...(expense.exchangeRate != null ? { exchangeRate: expense.exchangeRate } : {}),
  });
}

// =============================================================================
// createExpense
// =============================================================================

export async function createExpense(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const formattedErrors: Record<string, string> = {};
      errors.array().forEach((err) => {
        const path =
          (err as unknown as { path?: string; param?: string }).path ??
          (err as unknown as { path?: string; param?: string }).param ??
          'general';
        formattedErrors[path] = err.msg;
      });
      res.status(400).json({
        errors: formattedErrors,
      });
      return;
    }

    const userId = requireUserId(req);

    const {
      referenceNo,
      amount,
      expenseDate,
      paymentMode,
      paymentStatus,
      description,
      expenseCategoryId,
      sourceType,
      bankId,
      supplierId,
      paidByUserId,
      customFields = [],
      currencyCode: rawCurrencyCode,
      exchangeRate: rawExchangeRate,
    } = req.body as {
      referenceNo?: string;
      amount?: number | string;
      expenseDate?: string;
      paymentMode?: string;
      currencyCode?: string;
      exchangeRate?: number | string;
      paymentStatus?: string;
      description?: string;
      expenseCategoryId?: string;
      sourceType?: string;
      bankId?: string;
      supplierId?: string | null;
      paidByUserId?: string | null;
      customFields?: unknown;
    };

    // Normalise currency inputs (multipart text fields arrive as strings)
    const docCurrencyCode =
      typeof rawCurrencyCode === 'string' && rawCurrencyCode.trim().length === 3
        ? rawCurrencyCode.trim().toUpperCase()
        : undefined;
    const docExchangeRate =
      rawExchangeRate != null && rawExchangeRate !== ''
        ? toDecimal(rawExchangeRate)
        : undefined;

    const recurringBody = req.body as {
      isRecurring?: boolean | string;
      repeatEvery?: string;
      customIntervalNumber?: number | string;
      customIntervalType?: string;
      startOn?: string;
      endsOn?: string;
      neverExpire?: boolean | string;
      stopped?: boolean | string;
    };
    const isRecurringFlag =
      recurringBody.isRecurring === true || recurringBody.isRecurring === 'true';

    /* ===========================
       VALIDATION
    =========================== */

    if (!sourceType || !['BANK', 'PETTY_CASH', 'EMPLOYEE_PAID'].includes(sourceType)) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: {
          sourceType: 'Invalid source type. Must be BANK, PETTY_CASH or EMPLOYEE_PAID.',
        },
      });
      return;
    }

    if (sourceType === 'EMPLOYEE_PAID') {
      if (!paidByUserId) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { paidByUserId: 'Paid-by person is required for reimbursable expenses.' },
        });
        return;
      }
      // Scope the person to this tenant (owner self or a staff member).
      const person = await prisma.user.findFirst({
        where: { id: paidByUserId, isDeleted: false, OR: [{ id: userId }, { ownerId: userId }] },
        select: { id: true },
      });
      if (!person) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { paidByUserId: 'Paid-by person not found in your workspace.' },
        });
        return;
      }
    }

    if (sourceType === 'BANK' && !bankId) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { bankId: 'Bank ID is required for BANK expenses.' },
      });
      return;
    }

    if (sourceType === 'BANK' && !paymentMode) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { paymentMode: 'Payment mode is required for BANK expenses.' },
      });
      return;
    }

    if (!expenseCategoryId) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { expenseCategoryId: 'Expense category is required.' },
      });
      return;
    }

    const expenseAmount = parseFloat(String(amount));
    if (isNaN(expenseAmount) || expenseAmount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: { amount: 'Amount must be a valid positive number.' },
      });
      return;
    }

    /* ===========================
       ATTACHMENT
    =========================== */

    let attachment: string | null = null;

    if (req.file) {
      attachment = req.file.path;
    }

    const files = req.files as Express.Multer.File[] | undefined;

    /* ===========================
       FX RATE GUARD (create)
       Must run BEFORE any DB writes AND before the balance check so foreign-
       currency expenses without a configured rate are rejected as a clean 422,
       and so the base-currency register is compared/mutated in base currency.
    =========================== */
    const expenseDate_ = expenseDate ? new Date(expenseDate) : new Date();
    const fxResolution = await resolveExpenseFxRate(
      prisma as unknown as FxGuardDb,
      userId,
      docCurrencyCode,
      docExchangeRate,
      expenseDate_,
    );
    if (fxResolution.error) {
      res.status(422).json({
        success: false,
        message: 'Validation failed.',
        errors: { currencyCode: fxResolution.error },
      });
      return;
    }
    // The resolved rate supersedes whatever was in the request body.
    const effectiveExchangeRate = fxResolution.rate;
    // Base-currency value of the (possibly foreign) expense amount. The GL posts
    // in base, and bankDetail/pettyCash.currentBalance is a base-currency
    // register, so the register must move by this base amount — never the raw
    // foreign amount. (undefined rate → base-currency path → no conversion.)
    const baseExpenseAmount = toBaseAmount(expenseAmount, effectiveExchangeRate ?? null);

    /* ===========================
       BALANCE VALIDATION
    =========================== */

    if (sourceType === 'BANK') {
      const bank = await prisma.bankDetail.findFirst({
        where: { id: bankId as string, userId },
      });
      if (!bank) throw new Error('Bank not found.');

      const currentBalance = Number(bank.currentBalance ?? 0);
      if (baseExpenseAmount > currentBalance) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { amount: 'Insufficient bank balance for this expense.' },
        });
        return;
      }
    }

    if (sourceType === 'PETTY_CASH') {
      const pettyCash = await prisma.pettyCash.findFirst({
        where: { userId, isDeleted: false },
      });
      if (!pettyCash) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { amount: 'Petty cash not found.' },
        });
        return;
      }

      const currentBalance = Number(pettyCash.currentBalance ?? 0);
      if (baseExpenseAmount > currentBalance) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: {
            amount: `Insufficient balance, current balance is ${currentBalance}`,
          },
        });
        return;
      }
    }

    const parsedFields = parseCustomFields(customFields);

    const savedExpense = await prisma.$transaction(async (tx) => {
      // Approval gate: read companySettings for this tenant
      const settings = await tx.companySettings.findFirst({ where: { userId } });
      const approvalsEnabled = settings?.approvalsEnabled ?? false;

      /* ===========================
         CREATE EXPENSE
      =========================== */
      const generatedExpenseId = await generateNextExpenseId(tx);

      const expense = await tx.expense.create({
        data: {
          expenseId: generatedExpenseId,
          referenceNo: referenceNo || '',
          amount: toDecimal(expenseAmount),
          expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
          paymentModeId:
            sourceType === 'BANK' ? (paymentMode as string) : null,
          paymentStatus: ((paymentStatus as ExpensePaymentStatus) ||
            'PENDING') as ExpensePaymentStatus,
          description: description || '',
          attachment,
          expenseCategoryId: expenseCategoryId as string,
          sourceType: sourceType as ExpenseSourceType,
          bankId: sourceType === 'BANK' ? (bankId as string) : null,
          supplierId: (supplierId as string | null | undefined) || null,
          // paidByUserId: added by migration 20260623000004; regenerate Prisma client after deploy
          ...({ paidByUserId: sourceType === 'EMPLOYEE_PAID' ? (paidByUserId as string) : null } as Record<string, unknown>),
          userId,
          isRecurring: isRecurringFlag,
          repeatEvery: ((recurringBody.repeatEvery as string | undefined) ||
            'month') as RecurrenceFrequency,
          customIntervalNumber: recurringBody.customIntervalNumber
            ? Number(recurringBody.customIntervalNumber)
            : null,
          customIntervalType:
            (recurringBody.customIntervalType as RecurrenceCustomIntervalType | undefined) ||
            null,
          startOn: recurringBody.startOn
            ? new Date(recurringBody.startOn as string)
            : null,
          endsOn: recurringBody.endsOn
            ? new Date(recurringBody.endsOn as string)
            : null,
          neverExpire:
            recurringBody.neverExpire === true || recurringBody.neverExpire === 'true',
          stopped:
            recurringBody.stopped === true || recurringBody.stopped === 'true',
          nextRecurringDate:
            isRecurringFlag && recurringBody.startOn
              ? new Date(recurringBody.startOn as string)
              : null,
          approvalStatus: initialApprovalStatus(approvalsEnabled),
          // P3.3: optional dimension tagging
          costCenterId: typeof (req.body as Record<string, unknown>).costCenterId === 'string' && (req.body as Record<string, unknown>).costCenterId ? (req.body as Record<string, unknown>).costCenterId as string : null,
          projectId: typeof (req.body as Record<string, unknown>).projectId === 'string' && (req.body as Record<string, unknown>).projectId ? (req.body as Record<string, unknown>).projectId as string : null,
          // per-expense currency (resolved via FX guard above)
          ...(docCurrencyCode ? { currencyCode: docCurrencyCode } : {}),
          ...(effectiveExchangeRate !== undefined ? { exchangeRate: effectiveExchangeRate } : {}),
        },
      });

      /* ===========================
         BANK TRANSACTION
      =========================== */
      if (sourceType === 'BANK') {
        const paymentModeDetails = await tx.paymentMode.findUnique({
          where: { id: paymentMode as string },
        });
        if (!paymentModeDetails) throw new Error('Payment mode not found.');

        const bank = await tx.bankDetail.findFirst({
          where: { id: bankId as string, userId },
        });
        if (!bank) throw new Error('Bank not found.');

        const balanceBefore = Number(bank.currentBalance ?? 0);
        const balanceAfter = Number(
          (balanceBefore - baseExpenseAmount).toFixed(2),
        );

        await tx.bankDetail.update({
          where: { id: bank.id },
          data: { currentBalance: toDecimal(balanceAfter) },
        });

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankId as string,
            transactionDate: new Date(),
            type: (paymentModeDetails.slug === 'cash'
              ? 'WITHDRAWAL'
              : 'TRANSFER_OUT') as BankTransactionType,
            amount: toDecimal(baseExpenseAmount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            paymentModeId: paymentMode as string,
            referenceNo: referenceNo || null,
            remarks: description || null,
            relatedType: 'EXPENSE',
            relatedId: expense.id,
            // Banking A2: linked to the posted Expense → auto-explain + reconcile.
            // Reconciled iff the GL post actually ran at create (deferred when approvals on).
            // Reconciled iff the GL post actually runs at create: BOTH the
            // approvals gate AND the go-live posting gate (the same gate
            // gatedPost applies internally via postExpense → settings/date).
            ...explainedBankFields({
              postedSourceType: 'Expense',
              postedSourceId: expense.id,
              posted:
                shouldPostOnCreate(approvalsEnabled) &&
                shouldPost(settings, expense.expenseDate ?? new Date()),
              approvedById: userId,
              approvedAt: new Date(),
            }),
          },
        });
      }

      /* ===========================
         PETTY CASH TRANSACTION
      =========================== */
      if (sourceType === 'PETTY_CASH') {
        const pettyCash = await tx.pettyCash.findFirst({
          where: { userId, isDeleted: false },
        });
        if (!pettyCash) throw new Error('Petty cash not found.');

        const balanceBefore = Number(pettyCash.currentBalance ?? 0);
        const balanceAfter = Number(
          (balanceBefore - baseExpenseAmount).toFixed(2),
        );

        await tx.pettyCash.update({
          where: { id: pettyCash.id },
          data: { currentBalance: toDecimal(balanceAfter) },
        });

        await tx.pettyCashTransaction.create({
          data: {
            pettyCashId: pettyCash.id,
            transactionDate: new Date(),
            transactionType: 'SPEND' as PettyCashTransactionType,
            amount: toDecimal(baseExpenseAmount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            remarks: description || null,
            relatedType: 'EXPENSE',
            relatedId: expense.id,
          },
        });
      }

      /* ===========================
         SAVE CUSTOM FIELDS
      =========================== */
      const records: Prisma.CustomFieldValueCreateManyInput[] = [];
      for (const field of parsedFields) {
        let value: unknown = field.value ?? null;

        if (files && files.length > 0) {
          const fileField = files.find(
            (f) => f.fieldname === `customField_${field.fieldId}`,
          );
          if (fileField) value = fileField.path;
        }

        records.push({
          customFieldId: field.fieldId,
          module: 'expense',
          recordId: expense.id,
          value: (value ?? null) as Prisma.InputJsonValue,
          createdBy: userId,
        });
      }

      if (records.length > 0) {
        await tx.customFieldValue.createMany({ data: records });
      }

      /* ===========================
         CHANGE LOG
      =========================== */
      await tx.expenseChangeLog.create({
        data: {
          expenseId: expense.id,
          changedBy: userId,
          changes: [
            {
              field: 'create',
              oldValue: null,
              newValue: expense as unknown as Prisma.InputJsonValue,
            },
          ] as unknown as Prisma.InputJsonValue,
        },
      });

      /* ===========================
         GL POSTING (gated by approval status)
         Resolve the expense GL account: per-category GL account mapping is not
         modelled yet (future enhancement), so fall back to the tenant's
         PURCHASES role account. If no mapping exists at all, skip posting silently.
         When approvals are enabled, posting is deferred to approveExpense.
      =========================== */
      if (shouldPostOnCreate(approvalsEnabled)) {
        await postExpenseLedger(tx, expense, userId);
      }

      return expense;
    });

    res.status(201).json({
      success: true,
      message: 'Expense created successfully',
      data: savedExpense,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Create expense error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getAllExpenses
// =============================================================================

export async function getAllExpenses(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const scope = tenantScope(req);

    const {
      page = '1',
      limit = '10',
      paymentStatus,
      search = '',
      startDate,
      endDate,
      paymentMode,
      sourceType,
    } = req.query as {
      page?: string;
      limit?: string;
      paymentStatus?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      paymentMode?: string;
      sourceType?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.ExpenseWhereInput = { ...scope };

    if (
      paymentStatus &&
      ['PAID', 'CANCELLED', 'PENDING'].includes(paymentStatus.toUpperCase())
    ) {
      where.paymentStatus = paymentStatus.toUpperCase() as ExpensePaymentStatus;
    }

    if (paymentMode) {
      where.paymentModeId = paymentMode;
    }

    if (
      sourceType &&
      ['BANK', 'PETTY_CASH'].includes(sourceType.toUpperCase())
    ) {
      where.sourceType = sourceType.toUpperCase() as ExpenseSourceType;
    }

    const supplierIdFilter = req.query.supplierId as string | undefined;
    if (supplierIdFilter) {
      where.supplierId = supplierIdFilter;
    }

    // Drill-down from the P&L "Operating Expenses by category" rows passes
    // expenseCategoryId so the list shows exactly the expenses behind that figure.
    const expenseCategoryIdFilter = req.query.expenseCategoryId as string | undefined;
    if (expenseCategoryIdFilter) {
      where.expenseCategoryId = expenseCategoryIdFilter;
    }

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate)
        (where.expenseDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate)
        (where.expenseDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }

    if (search) {
      where.OR = [
        { expenseId: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, expenses] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: {
          paymentMode: { select: { id: true, name: true, slug: true } },
          expenseCategory: { select: { id: true, title: true } },
          bank: {
            select: { id: true, bankName: true, accountNumber: true },
          },
          supplier: { select: { id: true, supplier_name: true } },
          // Unified-contact-linked expenses leave the legacy `supplier` null,
          // so the party must resolve contact-first (see mapping below) —
          // otherwise the UI rendered a blank/"Deleted User" party.
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organisation: true,
              email: true,
              mobile: true,
              telephone: true,
              image: true,
            },
          },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    /* ========================================
       GET EXPENSE MODULE CUSTOM FIELDS
    ======================================== */
    const expenseModule = await prisma.module.findFirst({
      where: { moduleSlug: 'expenses' },
    });

    let tableFields: {
      id: string;
      fieldSlug: string;
      labelName: string;
    }[] = [];

    if (expenseModule) {
      tableFields = await prisma.customField.findMany({
        where: {
          moduleId: expenseModule.id,
          showInTable: true,
          deletedAt: null,
        },
        select: { id: true, fieldSlug: true, labelName: true },
      });
    }

    /* ========================================
       GET CUSTOM FIELD VALUES
    ======================================== */
    const expenseIds = expenses.map((e) => e.id);

    const customValues = await prisma.customFieldValue.findMany({
      where: {
        module: 'expense',
        recordId: { in: expenseIds },
      },
    });

    const customValueMap: Record<string, Record<string, unknown>> = {};
    customValues.forEach((val) => {
      const expId = val.recordId.toString();
      if (!customValueMap[expId]) {
        customValueMap[expId] = {};
      }
      customValueMap[expId][val.customFieldId] = val.value;
    });

    const baseUrl = buildBaseUrl(req);

    const formattedExpenses = expenses.map((exp) => {
      const customFieldsObject: Record<string, unknown> = {};
      tableFields.forEach((field) => {
        const expenseValues = customValueMap[exp.id] || {};
        customFieldsObject[field.fieldSlug] = expenseValues[field.id] ?? null;
      });

      return {
        id: exp.id,
        expenseId: exp.expenseId,
        referenceNo: exp.referenceNo,
        amount: exp.amount,
        currencyCode: exp.currencyCode ?? null,
        expenseDate: exp.expenseDate
          ? exp.expenseDate.toISOString().split('T')[0]
          : null,
        sourceType: exp.sourceType,
        expenseCategory: exp.expenseCategory
          ? { id: exp.expenseCategory.id, name: exp.expenseCategory.title }
          : null,
        paymentMode: exp.paymentMode
          ? { id: exp.paymentMode.id, name: exp.paymentMode.name }
          : null,
        bank: exp.bank
          ? {
              id: exp.bank.id,
              bankName: exp.bank.bankName,
              accountNumber: exp.bank.accountNumber,
            }
          : null,
        supplier: (exp.contact ?? exp.supplier)
          ? {
              id: exp.supplier?.id ?? exp.contact?.id ?? null,
              name:
                (exp.contact ? resolveDisplayName(exp.contact) : '') ||
                exp.supplier?.supplier_name ||
                '',
            }
          : null,
        paymentStatus: exp.paymentStatus,
        description: exp.description,
        attachment: exp.attachment
          ? `${baseUrl}${exp.attachment.replace(/\\/g, '/')}`
          : null,
        createdBy: exp.user
          ? { id: exp.user.id, name: `${exp.user.firstName ?? ''} ${exp.user.lastName ?? ''}`.trim() }
          : null,
        customFields: customFieldsObject,
        createdAt: exp.createdAt?.toISOString(),
        updatedAt: exp.updatedAt?.toISOString(),
      };
    });

    res.status(200).json({
      success: true,
      message: 'Expenses retrieved successfully',
      data: {
        expenses: formattedExpenses,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          totalPages: Math.ceil(total / limitN),
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List expenses error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching expenses',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getExpenseById
// =============================================================================

export async function getExpenseById(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const expense = await prisma.expense.findFirst({
      where: { ...scope, id },
      include: {
        paymentMode: { select: { id: true, name: true, slug: true } },
        expenseCategory: { select: { id: true, title: true } },
        bank: { select: { id: true, bankName: true, accountNumber: true } },
        supplier: { select: { id: true, supplier_name: true } },
        // Contact-first party resolution (see getAllExpenses above).
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          },
        },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!expense) {
      res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
      return;
    }

    /* ========================================
       GET MODULE CUSTOM FIELDS
    ======================================== */
    const expenseModule = await prisma.module.findFirst({
      where: { moduleSlug: 'expenses' },
    });

    let customFields: {
      id: string;
      fieldSlug: string;
      labelName: string;
      fieldType: { slug: string } | null;
    }[] = [];

    if (expenseModule) {
      customFields = await prisma.customField.findMany({
        where: { moduleId: expenseModule.id, deletedAt: null },
        select: {
          id: true,
          fieldSlug: true,
          labelName: true,
          fieldType: { select: { slug: true } },
        },
      });
    }

    /* ========================================
       GET VALUES
    ======================================== */
    const values = await prisma.customFieldValue.findMany({
      where: { module: 'expense', recordId: id },
    });

    const valueMap: Record<string, unknown> = {};
    values.forEach((v) => {
      valueMap[v.customFieldId] = v.value;
    });

    const customFieldResponse: Record<string, unknown> = {};
    customFields.forEach((field) => {
      customFieldResponse[field.fieldSlug] = valueMap[field.id] ?? null;
    });

    const baseUrl = buildBaseUrl(req);

    res.status(200).json({
      success: true,
      message: 'Expense retrieved successfully',
      data: {
        id: expense.id,
        expenseId: expense.expenseId,
        referenceNo: expense.referenceNo,
        amount: expense.amount,
        currencyCode: expense.currencyCode ?? null,
        expenseDate: expense.expenseDate
          ? expense.expenseDate.toISOString().split('T')[0]
          : null,
        sourceType: expense.sourceType,
        expenseCategory: expense.expenseCategory
          ? {
              id: expense.expenseCategory.id,
              name: expense.expenseCategory.title,
            }
          : null,
        paymentMode: expense.paymentMode
          ? { id: expense.paymentMode.id, name: expense.paymentMode.name }
          : null,
        bank: expense.bank
          ? {
              id: expense.bank.id,
              bankName: expense.bank.bankName,
              accountNumber: expense.bank.accountNumber,
            }
          : null,
        supplier: (expense.contact ?? expense.supplier)
          ? {
              id: expense.supplier?.id ?? expense.contact?.id ?? null,
              name:
                (expense.contact ? resolveDisplayName(expense.contact) : '') ||
                expense.supplier?.supplier_name ||
                '',
            }
          : null,
        paymentStatus: expense.paymentStatus,
        description: expense.description,
        attachment: expense.attachment
          ? `${baseUrl}${expense.attachment.replace(/\\/g, '/')}`
          : null,
        createdBy: expense.user
          ? { id: expense.user.id, name: `${expense.user.firstName ?? ''} ${expense.user.lastName ?? ''}`.trim() }
          : null,
        customFields: customFieldResponse,
        createdAt: expense.createdAt?.toISOString(),
        updatedAt: expense.updatedAt?.toISOString(),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get expense by ID error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateExpense
// =============================================================================

export async function updateExpense(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const expense = await prisma.expense.findFirst({
      where: { ...scope, id },
    });
    if (!expense) {
      res.status(404).json({
        success: false,
        message: 'Expense not found',
      });
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        errors: errors.array(),
      });
      return;
    }

    const {
      referenceNo,
      amount,
      expenseDate,
      paymentMode,
      paymentStatus,
      description,
      expenseCategoryId,
      sourceType,
      bankId,
      paidByUserId,
      customFields = [],
      currencyCode: updRawCurrencyCode,
      exchangeRate: updRawExchangeRate,
    } = req.body as {
      referenceNo?: string;
      amount?: number | string;
      expenseDate?: string;
      paymentMode?: string;
      paymentStatus?: string;
      description?: string;
      expenseCategoryId?: string;
      sourceType?: string;
      bankId?: string;
      paidByUserId?: string | null;
      customFields?: unknown;
      currencyCode?: string;
      exchangeRate?: number | string;
    };

    // Normalise currency inputs (multipart text fields arrive as strings)
    const updCurrencyCode =
      typeof updRawCurrencyCode === 'string' && updRawCurrencyCode.trim().length === 3
        ? updRawCurrencyCode.trim().toUpperCase()
        : undefined;
    const updExchangeRate =
      updRawExchangeRate != null && updRawExchangeRate !== ''
        ? toDecimal(updRawExchangeRate)
        : undefined;

    const attachment: string | null = req.file
      ? req.file.path
      : expense.attachment;

    // ---- compute changed fields (preserve original semantics) ----
    type FieldKey =
      | 'referenceNo'
      | 'amount'
      | 'expenseDate'
      | 'paymentMode'
      | 'paymentStatus'
      | 'description'
      | 'expenseCategoryId'
      | 'sourceType'
      | 'bankId'
      | 'attachment'
      | 'paidByUserId';

    const fields: FieldKey[] = [
      'referenceNo',
      'amount',
      'expenseDate',
      'paymentMode',
      'paymentStatus',
      'description',
      'expenseCategoryId',
      'sourceType',
      'bankId',
      'attachment',
      'paidByUserId',
    ];

    // Map body -> Prisma column for legacy field names
    const bodyMap: Record<FieldKey, unknown> = {
      referenceNo,
      amount,
      expenseDate,
      paymentMode,
      paymentStatus,
      description,
      expenseCategoryId,
      sourceType,
      bankId,
      attachment,
      paidByUserId,
    };

    const existingMap: Record<FieldKey, unknown> = {
      referenceNo: expense.referenceNo,
      amount: expense.amount,
      expenseDate: expense.expenseDate,
      paymentMode: expense.paymentModeId,
      paymentStatus: expense.paymentStatus,
      description: expense.description,
      expenseCategoryId: expense.expenseCategoryId,
      sourceType: expense.sourceType,
      bankId: expense.bankId,
      attachment: expense.attachment,
      paidByUserId: (expense as Record<string, unknown>).paidByUserId ?? null,
    };

    const oldSourceType = expense.sourceType;
    const oldBankId = expense.bankId;
    const oldAmount = Number(expense.amount);

    const changes: {
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }[] = [];

    const newValues: Partial<Record<FieldKey, unknown>> = {};

    fields.forEach((field) => {
      const incoming =
        field === 'attachment' ? attachment : bodyMap[field] ?? existingMap[field];

      if (existingMap[field] !== incoming) {
        changes.push({
          field,
          oldValue: existingMap[field],
          newValue: incoming,
        });
        newValues[field] = incoming;
      }
    });

    /* ===========================
       EMPLOYEE_PAID VALIDATION (update)
       Mirror createExpense ~255-279: if the resulting sourceType is EMPLOYEE_PAID,
       paidByUserId is required and must belong to this workspace.
       When switching away from EMPLOYEE_PAID, we explicitly null it out below.
    =========================== */
    const finalSourceType = (sourceType ?? expense.sourceType) as string | null;
    const finalPaidByUserId =
      paidByUserId !== undefined
        ? paidByUserId
        : ((expense as Record<string, unknown>).paidByUserId as string | null) ?? null;

    if (finalSourceType === 'EMPLOYEE_PAID') {
      if (!finalPaidByUserId) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { paidByUserId: 'Paid-by person is required for reimbursable expenses.' },
        });
        return;
      }
      // Scope the person to this tenant (owner self or a staff member).
      const person = await prisma.user.findFirst({
        where: {
          id: finalPaidByUserId,
          isDeleted: false,
          OR: [{ id: userId }, { ownerId: userId }],
        },
        select: { id: true },
      });
      if (!person) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { paidByUserId: 'Paid-by person not found in your workspace.' },
        });
        return;
      }
    }

    // Build Prisma update payload from newValues (mapping back to Prisma fields)
    const updateData: Prisma.ExpenseUpdateInput = {};
    if ('referenceNo' in newValues)
      updateData.referenceNo = (newValues.referenceNo as string) ?? null;
    if ('amount' in newValues)
      updateData.amount = toDecimal(newValues.amount);
    if ('expenseDate' in newValues)
      updateData.expenseDate = newValues.expenseDate
        ? new Date(String(newValues.expenseDate))
        : new Date();
    if ('paymentMode' in newValues) {
      updateData.paymentMode = newValues.paymentMode
        ? { connect: { id: newValues.paymentMode as string } }
        : { disconnect: true };
    }
    if ('paymentStatus' in newValues)
      updateData.paymentStatus = newValues.paymentStatus as ExpensePaymentStatus;
    if ('description' in newValues)
      updateData.description = (newValues.description as string) ?? null;
    if ('expenseCategoryId' in newValues)
      updateData.expenseCategory = {
        connect: { id: newValues.expenseCategoryId as string },
      };
    if ('sourceType' in newValues)
      updateData.sourceType = newValues.sourceType as ExpenseSourceType;
    if ('bankId' in newValues) {
      updateData.bank = newValues.bankId
        ? { connect: { id: newValues.bankId as string } }
        : { disconnect: true };
    }
    if ('attachment' in newValues)
      updateData.attachment = (newValues.attachment as string) ?? null;

    // paidByUserId: persist when EMPLOYEE_PAID, null out when switching away.
    // paidByUser is a relation, so use connect/disconnect (the scalar FK is
    // rejected by ExpenseUpdateInput). Always write to clear stale values on
    // source-type switches.
    updateData.paidByUser =
      finalSourceType === 'EMPLOYEE_PAID' && finalPaidByUserId
        ? { connect: { id: finalPaidByUserId } }
        : { disconnect: true };

    // per-expense currency (freely editable, like Purchase)
    if (updCurrencyCode !== undefined) {
      updateData.currencyCode = updCurrencyCode;
    }
    if (updExchangeRate !== undefined) {
      updateData.exchangeRate = updExchangeRate;
    }

    const body = req.body as {
      supplierId?: string | null;
      isRecurring?: boolean | string;
      repeatEvery?: string;
      customIntervalNumber?: number | string | null;
      customIntervalType?: string | null;
      startOn?: string | null;
      endsOn?: string | null;
      neverExpire?: boolean | string;
      stopped?: boolean | string;
      lastRecurringDate?: string | null;
      nextRecurringDate?: string | null;
    };
    if (body.supplierId !== undefined) {
      const newSupplierId = (body.supplierId as string | null) || null;
      if (newSupplierId) {
        updateData.supplier = { connect: { id: newSupplierId } };
      } else {
        updateData.supplier = { disconnect: true };
      }
      if (expense.supplierId !== newSupplierId) {
        changes.push({
          field: 'supplierId',
          oldValue: expense.supplierId,
          newValue: newSupplierId,
        });
      }
    }

    /* ===========================
       RECURRING FIELDS (partial)
    =========================== */
    if (body.isRecurring !== undefined) {
      const newVal = body.isRecurring === true || body.isRecurring === 'true';
      updateData.isRecurring = newVal;
      if (expense.isRecurring !== newVal) {
        changes.push({
          field: 'isRecurring',
          oldValue: expense.isRecurring,
          newValue: newVal,
        });
      }
    }
    if (body.repeatEvery !== undefined) {
      const newVal = (body.repeatEvery as RecurrenceFrequency) || null;
      updateData.repeatEvery = newVal;
      if (expense.repeatEvery !== newVal) {
        changes.push({
          field: 'repeatEvery',
          oldValue: expense.repeatEvery,
          newValue: newVal,
        });
      }
    }
    if (body.customIntervalNumber !== undefined) {
      const newVal =
        body.customIntervalNumber === null || body.customIntervalNumber === ''
          ? null
          : Number(body.customIntervalNumber);
      updateData.customIntervalNumber = newVal;
      if (expense.customIntervalNumber !== newVal) {
        changes.push({
          field: 'customIntervalNumber',
          oldValue: expense.customIntervalNumber,
          newValue: newVal,
        });
      }
    }
    if (body.customIntervalType !== undefined) {
      const newVal = (body.customIntervalType as RecurrenceCustomIntervalType) || null;
      updateData.customIntervalType = newVal;
      if (expense.customIntervalType !== newVal) {
        changes.push({
          field: 'customIntervalType',
          oldValue: expense.customIntervalType,
          newValue: newVal,
        });
      }
    }
    if (body.startOn !== undefined) {
      const newVal = body.startOn ? new Date(body.startOn as string) : null;
      updateData.startOn = newVal;
      changes.push({
        field: 'startOn',
        oldValue: expense.startOn,
        newValue: newVal,
      });
    }
    if (body.endsOn !== undefined) {
      const newVal = body.endsOn ? new Date(body.endsOn as string) : null;
      updateData.endsOn = newVal;
      changes.push({
        field: 'endsOn',
        oldValue: expense.endsOn,
        newValue: newVal,
      });
    }
    if (body.neverExpire !== undefined) {
      const newVal = body.neverExpire === true || body.neverExpire === 'true';
      updateData.neverExpire = newVal;
      if (expense.neverExpire !== newVal) {
        changes.push({
          field: 'neverExpire',
          oldValue: expense.neverExpire,
          newValue: newVal,
        });
      }
    }
    if (body.stopped !== undefined) {
      const newVal = body.stopped === true || body.stopped === 'true';
      updateData.stopped = newVal;
      if (expense.stopped !== newVal) {
        changes.push({
          field: 'stopped',
          oldValue: expense.stopped,
          newValue: newVal,
        });
      }
    }
    if (body.lastRecurringDate !== undefined) {
      const newVal = body.lastRecurringDate
        ? new Date(body.lastRecurringDate as string)
        : null;
      updateData.lastRecurringDate = newVal;
      changes.push({
        field: 'lastRecurringDate',
        oldValue: expense.lastRecurringDate,
        newValue: newVal,
      });
    }
    if (body.nextRecurringDate !== undefined) {
      const newVal = body.nextRecurringDate
        ? new Date(body.nextRecurringDate as string)
        : null;
      updateData.nextRecurringDate = newVal;
      changes.push({
        field: 'nextRecurringDate',
        oldValue: expense.nextRecurringDate,
        newValue: newVal,
      });
    }

    /* ===========================
       FX RATE GUARD (update)
       Determine the effective currency after this update and resolve a rate
       before any DB writes so misconfigurations surface as a clean 422.
    =========================== */
    // Effective post-update rate (undefined = base-currency path). Hoisted so the
    // base-currency register deltas below can convert the new amount consistently.
    let newExpenseRate: Prisma.Decimal | undefined;
    {
      // The post-update currency: if the request is changing it, use the
      // incoming value; otherwise preserve what's already on the row.
      const postUpdateCurrencyCode =
        updCurrencyCode !== undefined ? updCurrencyCode : (expense.currencyCode ?? undefined);
      const postUpdateSuppliedRate =
        updExchangeRate !== undefined ? updExchangeRate : (expense.exchangeRate ?? undefined);
      const updExpenseDate = newValues.expenseDate
        ? new Date(String(newValues.expenseDate))
        : (expense.expenseDate ?? new Date());

      const fxResolutionUpd = await resolveExpenseFxRate(
        prisma as unknown as FxGuardDb,
        userId,
        postUpdateCurrencyCode,
        postUpdateSuppliedRate,
        updExpenseDate,
      );
      if (fxResolutionUpd.error) {
        res.status(422).json({
          success: false,
          message: 'Validation failed.',
          errors: { currencyCode: fxResolutionUpd.error },
        });
        return;
      }
      // If the guard resolved a rate from the DB (not supplied by caller),
      // persist it on the expense row and use it for GL posting.
      if (fxResolutionUpd.rate !== undefined && updExchangeRate === undefined) {
        updateData.exchangeRate = fxResolutionUpd.rate;
      }
      newExpenseRate = fxResolutionUpd.rate;
    }

    // Base-currency register deltas. The cash register is base-currency, so the
    // refund of the OLD amount uses the OLD persisted rate and the deduction of
    // the NEW amount uses the NEW effective rate (undefined = base path).
    // Converting both keeps the register consistent with the FX-converted GL even
    // when the amount and/or rate change on edit.
    const oldBaseAmount = toBaseAmount(oldAmount, expense.exchangeRate ?? null);
    const newBaseAmount = toBaseAmount(asNumber(amount, 0), newExpenseRate ?? null);

    const parsedFields = parseCustomFields(customFields);
    const files = req.files as Express.Multer.File[] | undefined;

    const updatedExpense = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: expense.id },
        data: updateData,
      });

      // Whether the re-posted Expense JE actually posts under the go-live gate
      // (same settings/date the postExpense → gatedPost call below uses).
      // Bank lines created here are reconciled iff that JE truly posts.
      const ledgerSettings = await tx.companySettings.findFirst({ where: { userId } });
      const didPostExpense = shouldPost(
        ledgerSettings,
        updated.expenseDate ?? new Date(),
      );

      /* =====================================
         BANK / PETTY CASH TRANSACTIONS
      ===================================== */
      if (oldSourceType !== sourceType) {
        if (oldSourceType === 'BANK' && oldBankId) {
          await tx.bankTransaction.deleteMany({
            where: { relatedType: 'EXPENSE', relatedId: expense.id },
          });

          const bank = await tx.bankDetail.findUnique({
            where: { id: oldBankId },
          });
          if (bank) {
            const newBalance = Number(
              (Number(bank.currentBalance ?? 0) + oldBaseAmount).toFixed(2),
            );
            await tx.bankDetail.update({
              where: { id: bank.id },
              data: { currentBalance: toDecimal(newBalance) },
            });
          }
        } else if (oldSourceType === 'PETTY_CASH') {
          const pettyCash = await tx.pettyCash.findFirst({
            where: { userId, isDeleted: false },
          });

          await tx.pettyCashTransaction.deleteMany({
            where: { relatedType: 'EXPENSE', relatedId: expense.id },
          });

          if (pettyCash) {
            const newBalance = Number(
              (Number(pettyCash.currentBalance ?? 0) + oldBaseAmount).toFixed(2),
            );
            await tx.pettyCash.update({
              where: { id: pettyCash.id },
              data: { currentBalance: toDecimal(newBalance) },
            });
          }
        }

        if (sourceType === 'BANK') {
          const bank = await tx.bankDetail.findFirst({
            where: { id: bankId as string, userId },
          });
          if (!bank) throw new Error('Bank not found');

          const balanceBefore = Number(bank.currentBalance ?? 0);
          const balanceAfter = Number(
            (balanceBefore - newBaseAmount).toFixed(2),
          );

          await tx.bankDetail.update({
            where: { id: bank.id },
            data: { currentBalance: toDecimal(balanceAfter) },
          });

          await tx.bankTransaction.create({
            data: {
              bankAccountId: bankId as string,
              transactionDate: new Date(),
              type: 'PAYMENT' as BankTransactionType,
              amount: toDecimal(newBaseAmount),
              balanceBefore: toDecimal(balanceBefore),
              balanceAfter: toDecimal(balanceAfter),
              paymentModeId: paymentMode as string,
              relatedType: 'EXPENSE',
              relatedId: expense.id,
              remarks: description || null,
              // Banking A2: linked to the (re-posted) Expense → auto-explain + reconcile.
              // Reconciled iff the JE actually posts under the go-live gate.
              ...explainedBankFields({
                postedSourceType: 'Expense',
                postedSourceId: expense.id,
                posted: didPostExpense,
                approvedById: userId,
                approvedAt: new Date(),
              }),
            },
          });
        } else if (sourceType === 'PETTY_CASH') {
          const pettyCash = await tx.pettyCash.findFirst({
            where: { userId, isDeleted: false },
          });
          if (!pettyCash) throw new Error('Petty cash not found');

          const balanceBefore = Number(pettyCash.currentBalance ?? 0);
          const balanceAfter = Number(
            (balanceBefore - newBaseAmount).toFixed(2),
          );

          await tx.pettyCash.update({
            where: { id: pettyCash.id },
            data: { currentBalance: toDecimal(balanceAfter) },
          });

          await tx.pettyCashTransaction.create({
            data: {
              pettyCashId: pettyCash.id,
              transactionDate: new Date(),
              transactionType: 'SPEND' as PettyCashTransactionType,
              amount: toDecimal(newBaseAmount),
              balanceBefore: toDecimal(balanceBefore),
              balanceAfter: toDecimal(balanceAfter),
              relatedType: 'EXPENSE',
              relatedId: expense.id,
              remarks: description || null,
            },
          });
        }
      } else {
        // Source same → create a new transaction for the difference (base currency)
        const diff = newBaseAmount - oldBaseAmount;
        if (diff !== 0) {
          if (sourceType === 'BANK' && bankId) {
            const bank = await tx.bankDetail.findFirst({
              where: { id: bankId, userId },
            });
            if (!bank) throw new Error('Bank not found');

            const balanceBefore = Number(bank.currentBalance ?? 0);
            const balanceAfter = Number((balanceBefore - diff).toFixed(2));

            await tx.bankDetail.update({
              where: { id: bank.id },
              data: { currentBalance: toDecimal(balanceAfter) },
            });

            await tx.bankTransaction.create({
              data: {
                bankAccountId: bankId,
                transactionDate: new Date(),
                type: (diff > 0
                  ? 'TRANSFER_OUT'
                  : 'TRANSFER_IN') as BankTransactionType,
                amount: toDecimal(Math.abs(diff)),
                balanceBefore: toDecimal(balanceBefore),
                balanceAfter: toDecimal(balanceAfter),
                paymentModeId: paymentMode as string,
                relatedType: 'EXPENSE',
                relatedId: expense.id,
                remarks: description || null,
                // Banking A2: linked to the (re-posted) Expense → auto-explain + reconcile.
                // Reconciled iff the JE actually posts under the go-live gate.
                ...explainedBankFields({
                  postedSourceType: 'Expense',
                  postedSourceId: expense.id,
                  posted: didPostExpense,
                  approvedById: userId,
                  approvedAt: new Date(),
                }),
              },
            });
          } else if (sourceType === 'PETTY_CASH') {
            const pettyCash = await tx.pettyCash.findFirst({
              where: { userId, isDeleted: false },
            });
            if (!pettyCash) throw new Error('Petty cash not found');

            const balanceBefore = Number(pettyCash.currentBalance ?? 0);
            const balanceAfter = Number((balanceBefore - diff).toFixed(2));

            await tx.pettyCash.update({
              where: { id: pettyCash.id },
              data: { currentBalance: toDecimal(balanceAfter) },
            });

            await tx.pettyCashTransaction.create({
              data: {
                pettyCashId: pettyCash.id,
                transactionDate: new Date(),
                transactionType: (diff > 0
                  ? 'SPEND'
                  : 'ADD') as PettyCashTransactionType,
                amount: toDecimal(Math.abs(diff)),
                balanceBefore: toDecimal(balanceBefore),
                balanceAfter: toDecimal(balanceAfter),
                relatedType: 'EXPENSE',
                relatedId: expense.id,
                remarks: description || null,
              },
            });
          }
        }
      }

      /* =====================================
         CUSTOM FIELDS UPDATE
      ===================================== */
      await tx.customFieldValue.deleteMany({
        where: { module: 'expense', recordId: expense.id },
      });

      const records: Prisma.CustomFieldValueCreateManyInput[] = [];
      for (const field of parsedFields) {
        let value: unknown = field.value ?? null;

        if (files && files.length > 0) {
          const fileField = files.find(
            (f) => f.fieldname === `customField_${field.fieldId}`,
          );
          if (fileField) value = fileField.path;
        }

        records.push({
          customFieldId: field.fieldId,
          module: 'expense',
          recordId: expense.id,
          value: (value ?? null) as Prisma.InputJsonValue,
          createdBy: userId,
        });
      }

      if (records.length > 0) {
        await tx.customFieldValue.createMany({ data: records });
      }

      /* =====================================
         CHANGE LOG
      ===================================== */
      if (changes.length > 0) {
        await tx.expenseChangeLog.create({
          data: {
            expenseId: expense.id,
            changedBy: userId,
            changes: changes as unknown as Prisma.InputJsonValue,
          },
        });
      }

      /* =====================================
         GL POSTING: void old entry, re-post with updated amounts
      ===================================== */
      {
        await voidDocument(tx as unknown as PostingTx, {
          userId,
          sourceType: 'Expense',
          sourceId: expense.id,
          event: 'recorded',
        });
        const mapping = await tx.ledgerAccountMapping.findFirst({
          where: { userId, roleKey: 'PURCHASES' },
          select: { accountId: true },
        });
        if (mapping?.accountId) {
          const effectiveSourceType = (sourceType ?? expense.sourceType) as string | null;
          let paymentModeSlug: string | null = null;
          if (effectiveSourceType === 'BANK') {
            const effectivePaymentModeId = paymentMode ?? expense.paymentModeId;
            if (effectivePaymentModeId) {
              const pmDoc = await tx.paymentMode.findUnique({
                where: { id: effectivePaymentModeId },
                select: { slug: true },
              });
              paymentModeSlug = pmDoc?.slug ?? null;
            }
          }
          let employeePayableAccountId: string | undefined;
          if (effectiveSourceType === 'EMPLOYEE_PAID') {
            const owed = await tx.account.findFirst({
              where: { userId, code: '9250', isDeleted: false },
              select: { id: true },
            });
            if (!owed?.id) {
              throw new Error('Amounts Owed to Employees account (9250) is not initialized for this company.');
            }
            employeePayableAccountId = owed.id;
          }
          // effective currency: incoming value takes precedence; otherwise preserve existing
          const effectiveCurrencyCode =
            updCurrencyCode !== undefined ? updCurrencyCode : (updated.currencyCode ?? undefined);
          const effectiveExchangeRate =
            updExchangeRate !== undefined ? updExchangeRate : (updated.exchangeRate ?? undefined);
          const bankGlAccountId = effectiveSourceType === 'BANK'
            ? await resolveBankGlAccountId(tx as never, updated.bankId ?? null)
            : null;
          await postExpense(tx as unknown as PostingTx, {
            userId,
            expenseId: expense.id,
            date: updated.expenseDate ?? new Date(),
            total: String(updated.amount),
            tax: updated.tax != null ? String(updated.tax) : '0',
            expenseAccountId: mapping.accountId,
            sourceType: effectiveSourceType,
            paymentModeSlug,
            bankGlAccountId,
            ...(employeePayableAccountId ? { employeePayableAccountId } : {}),
            ...(effectiveCurrencyCode ? { currencyCode: effectiveCurrencyCode } : {}),
            ...(effectiveExchangeRate != null ? { exchangeRate: effectiveExchangeRate } : {}),
          });
        }
      }

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Expense updated successfully',
      data: updatedExpense,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Update expense error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteExpense
// =============================================================================

export async function deleteExpense(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const expense = await prisma.expense.findFirst({
      where: { ...scope, id },
    });
    if (!expense) {
      res
        .status(404)
        .json({ success: false, message: 'Expense not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // GL: reverse the posted recorded entry before soft-deleting
      await reverseDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'Expense',
        sourceId: id,
        event: 'recorded',
      });

      // Refund the cash source the expense drew from. createExpense DECREMENTED
      // bankDetail/pettyCash.currentBalance (WITHDRAWAL/TRANSFER_OUT or SPEND) and
      // left a bankTransaction behind; the GL reversal above did NOT touch those,
      // so without this the bank/petty balance stays reduced forever. Guard on
      // !isDeleted so re-deleting an already-deleted expense can't double-refund.
      // EMPLOYEE_PAID never moved bank/petty, so there is nothing to refund.
      if (!expense.isDeleted) {
        // Refund the SAME base amount create deducted: base = amount × the
        // expense's own persisted rate (createExpense converted foreign → base
        // before touching the register). Symmetric by construction because both
        // sides use the row's stored exchangeRate.
        const amount = toBaseAmount(Number(expense.amount ?? 0), expense.exchangeRate ?? null);
        if (expense.sourceType === 'BANK' && expense.bankId && amount) {
          const bank = await tx.bankDetail.findFirst({
            where: { id: expense.bankId, userId },
          });
          if (bank) {
            const balanceBefore = Number(bank.currentBalance ?? 0);
            const balanceAfter = Number((balanceBefore + amount).toFixed(2));

            // Invert the original outflow type: WITHDRAWAL→DEPOSIT (cash),
            // TRANSFER_OUT→TRANSFER_IN (everything else).
            let isCash = false;
            if (expense.paymentModeId) {
              const pm = await tx.paymentMode.findUnique({
                where: { id: expense.paymentModeId },
                select: { slug: true },
              });
              isCash = pm?.slug === 'cash';
            }
            const reversalType = (isCash ? 'DEPOSIT' : 'TRANSFER_IN') as BankTransactionType;

            await tx.bankDetail.update({
              where: { id: bank.id },
              data: { currentBalance: toDecimal(balanceAfter) },
            });

            await tx.bankTransaction.create({
              data: {
                bankAccountId: bank.id,
                transactionDate: new Date(),
                type: reversalType,
                amount: toDecimal(amount),
                balanceBefore: toDecimal(balanceBefore),
                balanceAfter: toDecimal(balanceAfter),
                paymentModeId: expense.paymentModeId!,
                remarks: `Reversal of deleted expense ${expense.expenseId ?? expense.id}`,
                relatedType: 'EXPENSE',
                relatedId: expense.id,
                // System-generated reversal of a deleted expense — payment-born
                // so banking renders it read-only and never explains/posts it
                // (the deletion already reversed the GL).
                isPaymentBorn: true,
              },
            });
          }
        } else if (expense.sourceType === 'PETTY_CASH' && amount) {
          const pettyCash = await tx.pettyCash.findFirst({
            where: { userId, isDeleted: false },
          });
          if (pettyCash) {
            const balanceBefore = Number(pettyCash.currentBalance ?? 0);
            const balanceAfter = Number((balanceBefore + amount).toFixed(2));

            await tx.pettyCash.update({
              where: { id: pettyCash.id },
              data: { currentBalance: toDecimal(balanceAfter) },
            });

            await tx.pettyCashTransaction.create({
              data: {
                pettyCashId: pettyCash.id,
                transactionDate: new Date(),
                transactionType: 'RETURN' as PettyCashTransactionType,
                amount: toDecimal(amount),
                balanceBefore: toDecimal(balanceBefore),
                balanceAfter: toDecimal(balanceAfter),
                remarks: `Reversal of deleted expense ${expense.expenseId ?? expense.id}`,
                relatedType: 'EXPENSE',
                relatedId: expense.id,
              },
            });
          }
        }
      }

      await tx.expense.update({
        where: { id: expense.id },
        data: { isDeleted: true },
      });
    });

    res.status(200).json({
      success: true,
      message: 'Expense deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Delete expense error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Recurring expense endpoints (slice C.2)
// =============================================================================

export async function getRecurringExpenses(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));
    const search = ((req.query.search as string) ?? '').trim();

    const where: Prisma.ExpenseWhereInput = {
      userId,
      isDeleted: false,
      isRecurring: true,
      parentExpense: null,
    };
    if (search) {
      where.OR = [{ referenceNo: { contains: search, mode: 'insensitive' } }];
    }

    const [rows, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          supplier: { select: { id: true, supplier_name: true } },
          // Contact-first party resolution (see getAllExpenses above).
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              organisation: true,
              email: true,
              mobile: true,
              telephone: true,
              image: true,
            },
          },
          expenseCategory: { select: { id: true, title: true } },
          _count: { select: { children: true } },
        },
      }),
      prisma.expense.count({ where }),
    ]);

    const data = rows.map((exp) => ({
      id: exp.id,
      referenceNo: exp.referenceNo,
      amount: exp.amount,
      supplier: (exp.contact ?? exp.supplier)
        ? {
            id: exp.supplier?.id ?? exp.contact?.id ?? null,
            name:
              (exp.contact ? resolveDisplayName(exp.contact) : '') ||
              exp.supplier?.supplier_name ||
              '',
          }
        : null,
      category: exp.expenseCategory ? { id: exp.expenseCategory.id, name: exp.expenseCategory.title } : null,
      repeatEvery: exp.repeatEvery,
      customIntervalNumber: exp.customIntervalNumber,
      customIntervalType: exp.customIntervalType,
      startOn: exp.startOn,
      endsOn: exp.endsOn,
      neverExpire: exp.neverExpire,
      stopped: exp.stopped,
      lastRecurringDate: exp.lastRecurringDate,
      nextRecurringDate: exp.nextRecurringDate,
      childrenCount: exp._count.children,
    }));

    res.json({
      success: true,
      data: {
        recurringExpenses: data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getRecurringExpenses error:', err);
    res.status(500).json({ success: false, message: 'Failed to list recurring expenses' });
  }
}

export async function getExpenseChildren(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const parent = await prisma.expense.findFirst({
      where: { id, userId, isDeleted: false },
      select: { id: true },
    });
    if (!parent) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }

    const rows = await prisma.expense.findMany({
      where: { parentExpense: id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        referenceNo: true,
        amount: true,
        expenseDate: true,
        paymentStatus: true,
      },
    });

    res.json({
      success: true,
      data: { children: rows.map((r) => ({ ...r })) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getExpenseChildren error:', err);
    res.status(500).json({ success: false, message: 'Failed to list child expenses' });
  }
}

export async function runRecurringExpenseNow(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const owned = await prisma.expense.findFirst({
      where: { id, userId, isDeleted: false, isRecurring: true, parentExpense: null },
      select: { id: true, stopped: true },
    });
    if (!owned) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }
    if (owned.stopped) {
      res.status(400).json({ success: false, message: 'Recurring schedule is stopped. Resume it first.' });
      return;
    }

    const out = await runRecurringForExpense(id);
    res.status(201).json({
      success: true,
      message: 'Recurring iteration created',
      data: { newExpenseId: out.newExpenseId },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SOURCE_NOT_FOUND') {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }
    if (msg === 'SOURCE_STOPPED') {
      res.status(400).json({ success: false, message: 'Recurring schedule is stopped' });
      return;
    }
    console.error('runRecurringExpenseNow error:', err);
    res.status(500).json({ success: false, message: 'Failed to run recurring' });
  }
}

export async function setExpenseRecurringStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as { stopped?: boolean };
    if (typeof body.stopped !== 'boolean') {
      res.status(400).json({ success: false, message: 'Body must include { stopped: boolean }' });
      return;
    }

    const existing = await prisma.expense.findFirst({
      where: { id, userId, isDeleted: false, isRecurring: true, parentExpense: null },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Recurring parent not found' });
      return;
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: { stopped: body.stopped },
      select: { id: true, stopped: true },
    });

    res.json({ success: true, message: 'Recurring status updated', data: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('setExpenseRecurringStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to update recurring status' });
  }
}

// Avoid unused-import lint warnings when only the namespace import is used.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _expenseRef = null as unknown as Expense | null;

// =============================================================================
// approveExpense — Spec D maker-checker
// =============================================================================

export async function approveExpense(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.expense.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Expense not found' });
      return;
    }
    if (existing.approvalStatus !== 'PENDING') {
      res.status(409).json({
        success: false,
        message: 'Not pending approval',
        current: existing.approvalStatus,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const approved = await tx.expense.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
      // Post ledger entries exactly as create would have (shared helper guarantees parity).
      await postExpenseLedger(tx, approved, userId);
      return approved;
    });

    res.status(200).json({ success: true, message: 'Expense approved', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('approveExpense error:', err);
    res.status(500).json({
      success: false,
      message: 'Error approving expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// rejectExpense — Spec D maker-checker
// =============================================================================

export async function rejectExpense(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const { reason } = req.body as { reason?: string };

    const existing = await prisma.expense.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Expense not found' });
      return;
    }
    if (existing.approvalStatus !== 'PENDING') {
      res.status(409).json({
        success: false,
        message: 'Not pending approval',
        current: existing.approvalStatus,
      });
      return;
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason: reason ?? null,
      },
    });

    void userId; // referenced for future audit-log use
    res.status(200).json({ success: true, message: 'Expense rejected', data: updated });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('rejectExpense error:', err);
    res.status(500).json({
      success: false,
      message: 'Error rejecting expense',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  approveExpense,
  rejectExpense,
};
module.exports.createExpense = createExpense;
module.exports.getAllExpenses = getAllExpenses;
module.exports.getExpenseById = getExpenseById;
module.exports.updateExpense = updateExpense;
module.exports.deleteExpense = deleteExpense;
module.exports.getRecurringExpenses = getRecurringExpenses;
module.exports.getExpenseChildren = getExpenseChildren;
module.exports.runRecurringExpenseNow = runRecurringExpenseNow;
module.exports.setExpenseRecurringStatus = setExpenseRecurringStatus;
module.exports.approveExpense = approveExpense;
module.exports.rejectExpense = rejectExpense;
