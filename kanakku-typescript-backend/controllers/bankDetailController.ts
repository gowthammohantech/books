import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  BankAccountType,
  BankTransactionType,
  BankTransactionRelatedType,
} from '@prisma/client';

import { prisma } from '../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../lib/tenantScope';
import { resolveDisplayName } from '../lib/contacts/contactIdentity';

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

// Prisma P2002 = unique constraint violation. Backstop for the accountNumber
// partial unique index in case a duplicate slips past the validator (e.g. a race,
// or an accountNumber change on update). Surfaces a clean 409 instead of a 500.
function isDuplicateAccountNumber(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function toNumber(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDecimal(v: unknown, fallback = 0): Prisma.Decimal {
  if (typeof v === 'number' || typeof v === 'string') {
    return new Prisma.Decimal(v);
  }
  return new Prisma.Decimal(fallback);
}

type BankDetailRow = {
  id: string;
  accountHoldername: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  bankCodeType: string | null;
  IFSCCode: string;
  accountType: BankAccountType;
  openingBalance: Prisma.Decimal | null;
  currentBalance: Prisma.Decimal | null;
  asOnDate: Date | null;
  currencyCode: string | null;
  status: boolean;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

function transformBankDetail(d: BankDetailRow): Record<string, unknown> {
  return {
    id: d.id,
    accountHoldername: d.accountHoldername,
    bankName: d.bankName,
    branchName: d.branchName,
    accountNumber: d.accountNumber,
    bankCodeType: d.bankCodeType ?? null,
    IFSCCode: d.IFSCCode,
    accountType: d.accountType,
    openingBalance: toNumber(d.openingBalance),
    currentBalance: toNumber(d.currentBalance),
    asOnDate: d.asOnDate,
    currencyCode: d.currencyCode ?? null,
    status: d.status,
    userId: d.userId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/**
 * The opening-balance deposit needs a PaymentMode (BankTransaction.paymentModeId
 * is non-nullable). The baseline install does NOT seed payment modes, so we
 * lazily get-or-create a "Bank Transfer" sentinel instead of hard-failing when
 * it's absent (that was returning a 500 on bank-account creation).
 */
async function getOrCreateBankPaymentMode(
  tx: Prisma.TransactionClient,
): Promise<{ id: string }> {
  const slug = 'bank-transfer';
  const existing = await tx.paymentMode.findUnique({ where: { slug } });
  if (existing) return { id: existing.id };
  const created = await tx.paymentMode.create({
    data: { name: 'Bank Transfer', slug, status: true },
  });
  return { id: created.id };
}

// BC.1: resolve the company default currency code (ISO string).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

// =============================================================================
// createBankDetail
// =============================================================================

export async function createBankDetail(req: Request, res: Response): Promise<void> {
  try {
    const {
      accountHoldername,
      bankName,
      branchName,
      accountNumber,
      bankCodeType,
      IFSCCode,
      accountType,
      openingBalance = 0,
      currentBalance,
      currencyCode,
      status = true,
    } = req.body as {
      accountHoldername: string;
      bankName: string;
      branchName: string;
      accountNumber: string;
      bankCodeType?: string | null;
      IFSCCode: string;
      accountType: BankAccountType;
      openingBalance?: number | string;
      currentBalance?: number | string;
      currencyCode?: string | null;
      status?: boolean;
    };

    // Scope the new bank account to the company tenant (owner id), the same id
    // the list query filters by — NOT the acting user's own id. This endpoint
    // is also reachable from the invoice "New Bank Account" modal, which used
    // to send the logged-in staff member's userId; those rows then never matched
    // the tenant-scoped list and were invisible in Settings → Bank Accounts.
    // See lib/tenantScope.ts for the shared-workspace scoping contract.
    const userId = requireUserId(req);

    const resolvedCurrentBalance =
      currentBalance !== undefined ? currentBalance : openingBalance;

    // Use supplied currency, else fall back to company default currency.
    const resolvedCurrencyCode =
      currencyCode && String(currencyCode).trim() !== ''
        ? String(currencyCode).trim().toUpperCase()
        : await resolveDefaultCurrencyCode();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'User not found',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const bankDetail = await tx.bankDetail.create({
        data: {
          accountHoldername,
          bankName,
          branchName,
          accountNumber,
          bankCodeType: bankCodeType ?? null,
          IFSCCode,
          accountType,
          openingBalance: toDecimal(openingBalance, 0),
          currentBalance: toDecimal(resolvedCurrentBalance, 0),
          asOnDate: new Date(),
          currencyCode: resolvedCurrencyCode,
          userId,
          status,
          isDeleted: false,
        },
      });

      // Create initial bank transaction (DEPOSIT) when there is an opening balance
      const currentBalanceNum = toNumber(resolvedCurrentBalance as never);
      if (currentBalanceNum > 0) {
        const paymentMode = await getOrCreateBankPaymentMode(tx);
        await tx.bankTransaction.create({
          data: {
            bankAccountId: bankDetail.id,
            transactionDate: new Date(),
            type: 'DEPOSIT',
            amount: toDecimal(currentBalanceNum),
            balanceBefore: toDecimal(0),
            balanceAfter: toDecimal(currentBalanceNum),
            paymentModeId: paymentMode.id,
            relatedType: 'MANUAL',
            relatedId: null,
            remarks: 'Initial deposit',
          },
        });
      }

      return bankDetail;
    });

    res.status(201).json({
      success: true,
      message: 'Bank detail created successfully',
      data: result,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (isDuplicateAccountNumber(err)) {
      res.status(409).json({
        success: false,
        message: 'A bank account with this account number already exists.',
      });
      return;
    }
    console.error('Bank detail creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating bank detail',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateBankDetail
// =============================================================================

export async function updateBankDetail(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const updates = { ...(req.body as Record<string, unknown>) };

    delete updates.id;
    delete updates._id;
    delete updates.userId;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.isDeleted;

    const existing = await prisma.bankDetail.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Bank detail not found',
      });
      return;
    }

    const data: Prisma.BankDetailUpdateInput = {};

    if (updates.accountHoldername !== undefined) {
      data.accountHoldername = updates.accountHoldername as string;
    }
    if (updates.bankName !== undefined) {
      data.bankName = updates.bankName as string;
    }
    if (updates.branchName !== undefined) {
      data.branchName = updates.branchName as string;
    }
    if (updates.accountNumber !== undefined) {
      data.accountNumber = updates.accountNumber as string;
    }
    if (updates.IFSCCode !== undefined) {
      data.IFSCCode = updates.IFSCCode as string;
    }
    if (updates.bankCodeType !== undefined) {
      data.bankCodeType = (updates.bankCodeType as string | null) || null;
    }
    if (updates.accountType !== undefined) {
      data.accountType = updates.accountType as BankAccountType;
    }
    if (updates.openingBalance !== undefined) {
      data.openingBalance = toDecimal(updates.openingBalance, 0);
    }
    if (updates.currentBalance !== undefined) {
      data.currentBalance = toDecimal(updates.currentBalance, 0);
    }
    if (updates.asOnDate !== undefined) {
      data.asOnDate = updates.asOnDate
        ? new Date(updates.asOnDate as string)
        : null;
    }
    if (updates.status !== undefined) {
      data.status = Boolean(updates.status);
    }
    if (updates.currencyCode !== undefined) {
      const cc = updates.currencyCode;
      data.currencyCode =
        cc && String(cc).trim() !== ''
          ? String(cc).trim().toUpperCase()
          : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      return tx.bankDetail.update({
        where: { id },
        data,
      });
    });

    res.status(200).json({
      success: true,
      message: 'Bank detail updated successfully',
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (isDuplicateAccountNumber(err)) {
      res.status(409).json({
        success: false,
        message: 'A bank account with this account number already exists.',
      });
      return;
    }
    console.error('Bank detail update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating bank detail',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getBankDetail
// =============================================================================

export async function getBankDetail(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);
    const { id } = req.params as { id: string };

    const bankDetail = await prisma.bankDetail.findFirst({
      where: { ...scope, id },
    });

    if (!bankDetail) {
      res.status(404).json({
        success: false,
        message: 'Bank detail not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: bankDetail,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Get bank detail error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching bank detail',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listBankDetails
// =============================================================================

export async function listBankDetails(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);

    const {
      page = '1',
      limit = '10',
      status,
      search = '',
      deleted,
    } = req.query as {
      page?: string;
      limit?: string;
      status?: string;
      search?: string;
      deleted?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.BankDetailWhereInput = { ...scope };

    // `deleted=true` lists the tenant's soft-deleted accounts (for the Deleted
    // tab + Restore flow). tenantScope defaults isDeleted:false, so override it.
    if (deleted === 'true') {
      where.isDeleted = true;
    }

    if (status !== undefined) {
      where.status = status === 'true';
    }

    if (search) {
      where.OR = [
        { accountHoldername: { contains: search, mode: 'insensitive' } },
        { bankName: { contains: search, mode: 'insensitive' } },
        { branchName: { contains: search, mode: 'insensitive' } },
        { accountNumber: { contains: search, mode: 'insensitive' } },
        { IFSCCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [bankDetails, total] = await Promise.all([
      prisma.bankDetail.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
      prisma.bankDetail.count({ where }),
    ]);

    const transformedDetails = bankDetails.map((detail) =>
      transformBankDetail(detail as BankDetailRow),
    );

    res.status(200).json({
      success: true,
      message: 'Bank details fetched successfully',
      data: {
        bankDetails: transformedDetails,
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
    console.error('List bank details error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching bank details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listBankTransactions
// =============================================================================

export async function listBankTransactions(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      bankAccountId,
      type,
      relatedType,
      search = '',
    } = req.query as {
      page?: string;
      limit?: string;
      bankAccountId?: string;
      type?: string;
      relatedType?: string;
      search?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.BankTransactionWhereInput = {
      isDeleted: false,
      bankAccount: { userId },
    };

    if (bankAccountId) {
      where.bankAccountId = bankAccountId;
    }

    if (type) {
      where.type = type.toUpperCase() as BankTransactionType;
    }

    if (relatedType) {
      where.relatedType = relatedType.toUpperCase() as BankTransactionRelatedType;
    }

    if (search) {
      where.OR = [
        { remarks: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        include: {
          bankAccount: {
            select: {
              id: true,
              accountHoldername: true,
              bankName: true,
              accountNumber: true,
            },
          },
          paymentMode: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limitN,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    const transformedTransactions = transactions.map((tx) => ({
      id: tx.id,
      bankAccount: tx.bankAccount
        ? {
            id: tx.bankAccount.id,
            accountHoldername: tx.bankAccount.accountHoldername,
            bankName: tx.bankAccount.bankName,
            accountNumber: tx.bankAccount.accountNumber,
          }
        : null,
      transactionDate: tx.transactionDate,
      type: tx.type,
      amount: toNumber(tx.amount),
      balanceBefore: toNumber(tx.balanceBefore),
      balanceAfter: toNumber(tx.balanceAfter),
      paymentMode: tx.paymentMode
        ? {
            id: tx.paymentMode.id,
            name: tx.paymentMode.name,
            slug: tx.paymentMode.slug,
          }
        : null,
      referenceNo: tx.referenceNo,
      remarks: tx.remarks,
      relatedType: tx.relatedType,
      relatedId: tx.relatedId,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Bank transactions fetched successfully',
      data: {
        transactions: transformedTransactions,
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
    console.error('List bank transactions error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching bank transactions',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateBankDetailStatus
// =============================================================================

export async function updateBankDetailStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: unknown };

    if (typeof status !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Status must be a boolean value',
      });
      return;
    }

    const existing = await prisma.bankDetail.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Bank detail not found',
      });
      return;
    }

    const bankDetail = await prisma.bankDetail.update({
      where: { id },
      data: { status },
    });

    res.status(200).json({
      success: true,
      message: 'Bank detail status updated successfully',
      data: {
        id: bankDetail.id,
        status: bankDetail.status,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Bank detail status update error:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating bank detail status',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteBankDetail
// =============================================================================

export async function deleteBankDetail(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.bankDetail.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Bank detail not found',
      });
      return;
    }

    await prisma.bankDetail.update({
      where: { id },
      data: { isDeleted: true },
    });

    res.status(200).json({
      success: true,
      message: 'Bank detail deleted successfully',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Delete bank detail error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting bank detail',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// restoreBankDetail — un-delete a soft-deleted account (brings back its history)
// =============================================================================

export async function restoreBankDetail(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.bankDetail.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Bank detail not found',
      });
      return;
    }
    if (!existing.isDeleted) {
      res.status(200).json({
        success: true,
        message: 'Bank account is already active',
        data: existing,
      });
      return;
    }

    const restored = await prisma.bankDetail.update({
      where: { id },
      data: { isDeleted: false },
    });

    res.status(200).json({
      success: true,
      message: 'Bank account restored successfully',
      data: restored,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    // The partial unique index only covers active rows, so restoring collides
    // only if an active account already claimed this number (e.g. it was
    // recreated after deletion). Surface that clearly instead of a 500.
    if (isDuplicateAccountNumber(err)) {
      res.status(409).json({
        success: false,
        message:
          'An active bank account already uses this account number. Delete or renumber it before restoring this one.',
      });
      return;
    }
    console.error('Bank detail restore error:', err);
    res.status(500).json({
      success: false,
      message: 'Error restoring bank detail',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// reconcileTransaction
// =============================================================================

export async function reconcileTransaction(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const { isReconciled, reconciliationNote } = req.body as {
      isReconciled: boolean;
      reconciliationNote?: string | null;
    };

    const transaction = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId } },
    });
    if (!transaction || transaction.isDeleted) {
      res.status(404).json({ success: false, message: 'Transaction not found.' });
      return;
    }

    const updated = await prisma.bankTransaction.update({
      where: { id },
      data: {
        isReconciled,
        reconciledBy: isReconciled ? userId : null,
        reconciliationDate: isReconciled ? new Date() : null,
        reconciliationNote: isReconciled ? reconciliationNote ?? null : null,
      },
    });

    res.status(200).json({
      success: true,
      message: `Transaction ${isReconciled ? 'reconciled' : 'unreconciled'} successfully.`,
      data: updated,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error in reconcileTransaction:', err);
    res.status(500).json({
      success: false,
      message: 'Something went wrong.',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listFinancialDetails
// =============================================================================

export async function listFinancialDetails(req: Request, res: Response): Promise<void> {
  try {
    const scope = tenantScope(req);

    const { status, search = '' } = req.query as {
      status?: string;
      search?: string;
    };

    const where: Prisma.BankDetailWhereInput = { ...scope };

    if (status !== undefined) {
      where.status = status === 'true';
    }

    if (search) {
      where.OR = [
        { accountHoldername: { contains: search, mode: 'insensitive' } },
        { bankName: { contains: search, mode: 'insensitive' } },
        { branchName: { contains: search, mode: 'insensitive' } },
        { accountNumber: { contains: search, mode: 'insensitive' } },
        { IFSCCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Fetch all bank details
    const bankDetails = await prisma.bankDetail.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Helper to compute today/last day totals from rows of {currentBalance, updatedAt}
    type BalanceRow = { currentBalance: Prisma.Decimal | null; updatedAt: Date };
    const getDailyTotals = (rows: BalanceRow[]) => {
      const buckets = new Map<string, number>();
      for (const r of rows) {
        const d = r.updatedAt;
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
        const cur = buckets.get(key) ?? 0;
        buckets.set(key, cur + toNumber(r.currentBalance));
      }
      const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
        const [ay, am, ad] = a.split('-').map(Number);
        const [by, bm, bd] = b.split('-').map(Number);
        if (by !== ay) return by - ay;
        if (bm !== am) return bm - am;
        return bd - ad;
      });
      const todayTotal = sortedKeys.length > 0 ? buckets.get(sortedKeys[0]) ?? 0 : 0;
      const lastTotal = sortedKeys.length > 1 ? buckets.get(sortedKeys[1]) ?? 0 : 0;
      return { todayTotal, lastTotal };
    };

    // Fetch all non-deleted bank details for this tenant, for totals.
    const allBankRows = await prisma.bankDetail.findMany({
      where: { ...scope },
      select: { currentBalance: true, updatedAt: true },
    });
    const allPettyRows = await prisma.pettyCash.findMany({
      where: { userId: scope.userId, isDeleted: false },
      select: { currentBalance: true, updatedAt: true },
    });

    const { todayTotal: bankCurrentTotal, lastTotal: bankLastTotal } =
      getDailyTotals(allBankRows);
    const { todayTotal: pettyCurrentTotal, lastTotal: pettyLastTotal } =
      getDailyTotals(allPettyRows);

    const bankFlag =
      bankCurrentTotal > bankLastTotal
        ? 'up'
        : bankCurrentTotal < bankLastTotal
          ? 'down'
          : 'equal';
    const pettyFlag =
      pettyCurrentTotal > pettyLastTotal
        ? 'up'
        : pettyCurrentTotal < pettyLastTotal
          ? 'down'
          : 'equal';

    const transformedDetails = bankDetails.map((detail) =>
      transformBankDetail(detail as BankDetailRow),
    );

    res.status(200).json({
      success: true,
      message: 'Financial details fetched successfully',
      data: {
        totals: {
          bankCurrentTotal,
          bankLastTotal,
          bankFlag,
          pettyCurrentTotal,
          pettyLastTotal,
          pettyFlag,
        },
        bankDetails: transformedDetails,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List financial details error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching financial details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listBankTransactionsReconciled
// =============================================================================

export async function listBankTransactionsReconciled(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      bankAccountId,
      isReconciled,
      type,
      relatedType,
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      bankAccountId?: string;
      isReconciled?: string;
      type?: string;
      relatedType?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.BankTransactionWhereInput = {
      isDeleted: false,
      bankAccount: { userId },
    };

    if (bankAccountId) {
      where.bankAccountId = bankAccountId;
    }

    if (isReconciled !== undefined) {
      where.isReconciled = isReconciled === 'true';
    }

    if (type) {
      where.type = type.toUpperCase() as BankTransactionType;
    }

    if (relatedType) {
      where.relatedType = relatedType.toUpperCase() as BankTransactionRelatedType;
    }

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      where.transactionDate = dateFilter;
    }

    if (search) {
      where.OR = [
        { remarks: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        include: {
          bankAccount: {
            select: {
              id: true,
              accountHoldername: true,
              bankName: true,
              accountNumber: true,
            },
          },
          paymentMode: { select: { id: true, name: true, slug: true } },
          reconciledByUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limitN,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    const transformedTransactions = transactions.map((tx) => ({
      id: tx.id,
      bankAccount: tx.bankAccount
        ? {
            id: tx.bankAccount.id,
            accountHoldername: tx.bankAccount.accountHoldername,
            bankName: tx.bankAccount.bankName,
            accountNumber: tx.bankAccount.accountNumber,
          }
        : null,
      transactionDate: tx.transactionDate,
      type: tx.type,
      amount: toNumber(tx.amount),
      balanceBefore: toNumber(tx.balanceBefore),
      balanceAfter: toNumber(tx.balanceAfter),
      paymentMode: tx.paymentMode
        ? {
            id: tx.paymentMode.id,
            name: tx.paymentMode.name,
            slug: tx.paymentMode.slug,
          }
        : null,
      referenceNo: tx.referenceNo,
      remarks: tx.remarks,
      relatedType: tx.relatedType,
      relatedId: tx.relatedId,
      isReconciled: tx.isReconciled ?? false,
      reconciledBy: tx.reconciledByUser
        ? {
            id: tx.reconciledByUser.id,
            name: `${tx.reconciledByUser.firstName || ''} ${tx.reconciledByUser.lastName || ''}`.trim(),
            email: tx.reconciledByUser.email,
          }
        : null,
      reconciliationDate: tx.reconciliationDate ?? null,
      reconciliationNote: tx.reconciliationNote ?? null,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: 'Bank transactions fetched successfully',
      data: {
        transactions: transformedTransactions,
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
    console.error('List bank transactions with reconciled filter error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching bank transactions',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getBankTransactionDetails
// =============================================================================

export async function getBankTransactionDetails(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const transaction = await prisma.bankTransaction.findFirst({
      where: { id, bankAccount: { userId } },
      include: {
        bankAccount: { select: { bankName: true, accountNumber: true } },
        paymentMode: { select: { name: true } },
        reconciledByUser: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!transaction) {
      res.status(404).json({
        success: false,
        message: 'Bank transaction not found',
      });
      return;
    }

    const baseUrl = process.env.BASE_URL ?? '';
    let relatedData: unknown = null;

    switch (transaction.relatedType) {
      case 'EXPENSE': {
        if (transaction.relatedId) {
          const expense = await prisma.expense.findUnique({
            where: { id: transaction.relatedId },
            include: {
              expenseCategory: { select: { title: true } },
              paymentMode: { select: { name: true } },
              bank: { select: { bankName: true, accountNumber: true } },
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  profileImage: true,
                },
              },
            },
          });

          if (expense) {
            const user = expense.user
              ? {
                  firstName: expense.user.firstName || '',
                  lastName: expense.user.lastName || '',
                  email: expense.user.email || '',
                  phone: expense.user.phone || '',
                  profileImage: expense.user.profileImage
                    ? `${baseUrl}/${expense.user.profileImage}`
                    : '',
                }
              : null;

            const category = expense.expenseCategory
              ? expense.expenseCategory.title
              : '';

            const paymentModeName = expense.paymentMode
              ? expense.paymentMode.name
              : '';

            relatedData = {
              id: expense.id,
              expenseId: expense.expenseId,
              referenceNo: expense.referenceNo || '',
              amount: toNumber(expense.amount),
              expenseDate: expense.expenseDate
                ? expense.expenseDate.toISOString().split('T')[0]
                : null,
              paymentMode: paymentModeName,
              category,
              description: expense.description || '',
              attachment: expense.attachment
                ? `${baseUrl}/${expense.attachment}`
                : '',
              sourceType: expense.sourceType,
              bank: expense.bank
                ? {
                    name: expense.bank.bankName,
                    accountNumber: expense.bank.accountNumber,
                  }
                : null,
              createdBy: user,
            };
          }
        }
        break;
      }

      case 'SUPPLIER_PAYMENT': {
        if (transaction.relatedId) {
          const contactSelect = {
            id: true,
            firstName: true,
            lastName: true,
            organisation: true,
            email: true,
            mobile: true,
            telephone: true,
            image: true,
          } as const;

          const payment = await prisma.supplierPayment.findUnique({
            where: { id: transaction.relatedId },
            include: {
              purchase: {
                select: {
                  purchaseId: true,
                  totalAmount: true,
                  contact: { select: contactSelect },
                },
              },
              contact: { select: contactSelect },
              supplier: {
                select: {
                  id: true,
                  supplier_name: true,
                  supplier_email: true,
                  supplier_phone: true,
                  profileImage: true,
                },
              },
              paymentMode: { select: { name: true } },
              bank: { select: { bankName: true, accountNumber: true } },
              createdByUser: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });

          if (payment) {
            // Contact-first party resolution (mirrors listSupplierPayments):
            // prefer the payment's own unified Contact, then the purchase's
            // Contact, then the legacy Supplier. New-flow payments can carry
            // a contactId with no legacy supplierId, which previously
            // resolved to a blank/"Deleted User" party.
            const directContact = payment.contact ?? payment.purchase?.contact ?? null;
            if (payment.supplier || directContact) {
              const supplierName =
                (directContact ? resolveDisplayName(directContact) : '') ||
                payment.supplier?.supplier_name ||
                '';
              const supplierEmail =
                directContact?.email || payment.supplier?.supplier_email || null;
              const supplierPhone =
                directContact?.mobile ||
                directContact?.telephone ||
                payment.supplier?.supplier_phone ||
                null;
              const rawImage = payment.supplier?.profileImage || directContact?.image;
              const supplierProfileImage = rawImage ? `${baseUrl}/${rawImage}` : '';
              relatedData = {
                ...payment,
                supplierId: {
                  id: payment.supplier?.id ?? directContact?.id ?? null,
                  supplier_name: supplierName,
                  supplier_email: supplierEmail,
                  supplier_phone: supplierPhone,
                  profileImage: supplierProfileImage,
                },
              };
            } else {
              relatedData = payment;
            }
          } else {
            relatedData = payment;
          }
        }
        break;
      }

      case 'INVOICE_PAYMENT': {
        if (transaction.relatedId) {
          relatedData = await prisma.invoicePayment.findUnique({
            where: { id: transaction.relatedId },
            include: {
              invoice: {
                select: { invoiceNumber: true, TotalAmount: true },
              },
              paymentMode: { select: { name: true } },
              bank: { select: { bankName: true, accountNumber: true } },
              receivedByUser: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          });
        }
        break;
      }

      default:
        relatedData = null;
        break;
    }

    res.status(200).json({
      success: true,
      data: relatedData,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error fetching transaction details:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
const all = {
  createBankDetail,
  updateBankDetail,
  getBankDetail,
  listBankDetails,
  updateBankDetailStatus,
  listBankTransactions,
  deleteBankDetail,
  restoreBankDetail,
  reconcileTransaction,
  listFinancialDetails,
  listBankTransactionsReconciled,
  getBankTransactionDetails,
};

module.exports = { ...all };
module.exports.createBankDetail = createBankDetail;
module.exports.updateBankDetail = updateBankDetail;
module.exports.getBankDetail = getBankDetail;
module.exports.listBankDetails = listBankDetails;
module.exports.updateBankDetailStatus = updateBankDetailStatus;
module.exports.listBankTransactions = listBankTransactions;
module.exports.deleteBankDetail = deleteBankDetail;
module.exports.restoreBankDetail = restoreBankDetail;
module.exports.reconcileTransaction = reconcileTransaction;
module.exports.listFinancialDetails = listFinancialDetails;
module.exports.listBankTransactionsReconciled = listBankTransactionsReconciled;
module.exports.getBankTransactionDetails = getBankTransactionDetails;
