import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  PettyCashTransactionType,
  PettyCashTransactionRelatedType,
  BankTransactionType,
} from '@prisma/client';
import dayjs from 'dayjs';

import { prisma } from '../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../lib/tenantScope';
import { explainedBankFields } from '../lib/moneyFlow/explainedBankFields';

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

// =============================================================================
// createPettyCash
// =============================================================================

export async function createPettyCash(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      bankAccountId,
      amount: rawAmount,
      paymentModeId,
    } = req.body as {
      bankAccountId?: string;
      amount?: number | string;
      paymentModeId?: string;
    };

    const amount = parseFloat(String(rawAmount));
    if (Number.isNaN(amount) || amount <= 0) {
      res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
      return;
    }

    if (!bankAccountId || !paymentModeId) {
      res.status(400).json({
        success: false,
        message: 'bankAccountId and paymentModeId are required',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      // Find payment mode first
      const paymentMode = await tx.paymentMode.findUnique({
        where: { id: paymentModeId },
      });
      if (!paymentMode) {
        return { status: 404, body: { success: false, message: 'Payment mode not found' } };
      }

      const bankAccount = await tx.bankDetail.findUnique({
        where: { id: bankAccountId },
      });
      if (!bankAccount || bankAccount.isDeleted) {
        return { status: 404, body: { success: false, message: 'Bank account not found' } };
      }

      // Convert bankAccount.currentBalance to float for comparison
      const bankBalance = Number(bankAccount.currentBalance ?? 0);
      if (bankBalance < amount) {
        return { status: 400, body: { success: false, message: 'Insufficient bank balance' } };
      }

      // Determine bank transaction type based on payment mode slug
      const bankTransactionType: BankTransactionType =
        paymentMode.slug === 'cash' ? 'WITHDRAWAL' : 'TRANSFER_OUT';

      // Check if this tenant's petty cash account exists (strictly scoped —
      // one per tenant, never a shared/legacy row from another tenant).
      let pettyCash = await tx.pettyCash.findFirst({ where: { userId } });

      const pettyBalanceBefore = pettyCash ? Number(pettyCash.currentBalance ?? 0) : 0;
      const pettyBalanceAfter = pettyBalanceBefore + amount;

      if (!pettyCash) {
        pettyCash = await tx.pettyCash.create({
          data: {
            userId,
            openingBalance: toDecimal(amount),
            currentBalance: toDecimal(amount),
            asOnDate: new Date(),
          },
        });
      } else {
        pettyCash = await tx.pettyCash.update({
          where: { id: pettyCash.id },
          data: {
            currentBalance: toDecimal(pettyBalanceAfter),
            asOnDate: new Date(),
          },
        });
      }

      const bankBalanceAfter = bankBalance - amount;

      // Create bank transaction
      const bankTransaction = await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          transactionDate: new Date(),
          type: bankTransactionType,
          amount: toDecimal(amount),
          balanceBefore: toDecimal(bankBalance),
          balanceAfter: toDecimal(bankBalanceAfter),
          paymentModeId: paymentModeId,
          relatedType: 'PETTYCASH',
          relatedId: pettyCash.id,
          remarks: 'Transfer to petty cash',
          // Banking A2: petty-cash transfer is a linked, intended-explained line.
          // This path writes no GL journal entry → posted:false (not reconciled).
          ...explainedBankFields({
            postedSourceType: 'PettyCash',
            postedSourceId: pettyCash.id,
            posted: false,
            approvedById: userId,
            approvedAt: new Date(),
          }),
        },
      });

      // Update bank account balance
      await tx.bankDetail.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: toDecimal(bankBalanceAfter),
          asOnDate: new Date(),
        },
      });

      // Create petty cash transaction (ADD)
      const pettyTransaction = await tx.pettyCashTransaction.create({
        data: {
          pettyCashId: pettyCash.id,
          transactionDate: new Date(),
          transactionType: 'ADD',
          amount: toDecimal(amount),
          balanceBefore: toDecimal(pettyBalanceBefore),
          balanceAfter: toDecimal(pettyBalanceAfter),
          remarks: 'Transferred from bank account',
          relatedType: 'BANK', // Changed from 'PETTY_CASH' to 'BANK'
          relatedId: bankTransaction.id,
        },
      });

      return {
        status: 201,
        body: {
          success: true,
          message: 'Petty cash created/updated successfully with bank transfer',
          data: {
            pettyCash,
            bankTransaction: {
              ...bankTransaction,
              type: bankTransactionType,
              paymentMode: paymentMode.name,
            },
            pettyTransaction,
          },
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Petty cash creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating petty cash',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listPettyCash
// =============================================================================

export async function listPettyCash(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    // Fetch this tenant's petty cash record.
    const pettyCash = await prisma.pettyCash.findFirst({
      where: { isDeleted: false, userId },
    });
    if (!pettyCash) {
      res.status(200).json({
        success: true,
        message: 'No petty cash found',
        data: { pettyCash: null },
      });
      return;
    }

    // Transform petty cash data
    const pettyCashData = {
      id: pettyCash.id,
      openingBalance: Number(pettyCash.openingBalance ?? 0),
      currentBalance: Number(pettyCash.currentBalance ?? 0),
      asOnDate: pettyCash.asOnDate,
      createdAt: pettyCash.createdAt,
      updatedAt: pettyCash.updatedAt,
    };

    res.status(200).json({
      success: true,
      message: 'Petty cash details fetched successfully',
      data: {
        pettyCash: pettyCashData,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('List petty cash error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching petty cash details',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// returnPettyCash
// =============================================================================

export async function returnPettyCash(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      bankAccountId,
      amount: rawAmount,
      paymentModeId,
      remarks,
    } = req.body as {
      bankAccountId?: string;
      amount?: number | string;
      paymentModeId?: string;
      remarks?: string;
    };

    if (!bankAccountId || rawAmount === undefined || rawAmount === null || rawAmount === '' || !paymentModeId) {
      res.status(400).json({
        success: false,
        message: 'bankAccountId, amount, and paymentModeId are required',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      // Find payment mode first
      const paymentMode = await tx.paymentMode.findUnique({
        where: { id: paymentModeId },
      });
      if (!paymentMode) {
        return { status: 404, body: { success: false, message: 'Payment mode not found' } };
      }

      // Fetch this tenant's petty cash record.
      const pettyCash = await tx.pettyCash.findFirst({ where: { userId } });
      if (!pettyCash) {
        return { status: 404, body: { success: false, message: 'Petty cash not found' } };
      }

      const pettyBalanceBefore = Number(pettyCash.currentBalance ?? 0);
      const returnAmount = parseFloat(String(rawAmount));

      // Reject non-positive / NaN amounts (mirror createPettyCash's validator).
      // Without this a negative amount slips past the `balance < amount` check and
      // INCREASES petty cash while DRAINING the bank; NaN blows up the Decimal.
      if (Number.isNaN(returnAmount) || returnAmount <= 0) {
        return {
          status: 400,
          body: { success: false, message: 'Invalid amount' },
        };
      }

      if (pettyBalanceBefore < returnAmount) {
        return {
          status: 400,
          body: { success: false, message: 'Insufficient petty cash balance' },
        };
      }

      // Fetch bank account
      const bankAccount = await tx.bankDetail.findUnique({
        where: { id: bankAccountId },
      });
      if (!bankAccount || bankAccount.isDeleted) {
        return { status: 404, body: { success: false, message: 'Bank account not found' } };
      }

      // Calculate balances before/after
      const pettyBalanceAfter = pettyBalanceBefore - returnAmount;
      const bankBalanceBefore = Number(bankAccount.currentBalance ?? 0);
      const bankBalanceAfter = bankBalanceBefore + returnAmount;

      // Determine bank transaction type based on payment mode slug
      const bankTransactionType: BankTransactionType =
        paymentMode.slug === 'cash' ? 'DEPOSIT' : 'TRANSFER_IN';

      // Create bank transaction FIRST to get its ID
      const bankTransaction = await tx.bankTransaction.create({
        data: {
          bankAccountId: bankAccount.id,
          transactionDate: new Date(),
          type: bankTransactionType,
          amount: toDecimal(returnAmount),
          balanceBefore: toDecimal(bankBalanceBefore),
          balanceAfter: toDecimal(bankBalanceAfter),
          paymentModeId: paymentModeId,
          relatedType: 'PETTYCASH',
          relatedId: pettyCash.id,
          remarks: remarks || 'Returned petty cash deposit',
          // Banking A2: petty-cash return is a linked, intended-explained line.
          // This path writes no GL journal entry → posted:false (not reconciled).
          ...explainedBankFields({
            postedSourceType: 'PettyCash',
            postedSourceId: pettyCash.id,
            posted: false,
            approvedById: userId,
            approvedAt: new Date(),
          }),
        },
      });

      // Create petty cash transaction (RETURN) with bankTransaction ID as relatedId
      const pettyTransaction = await tx.pettyCashTransaction.create({
        data: {
          pettyCashId: pettyCash.id,
          transactionDate: new Date(),
          transactionType: 'RETURN',
          amount: toDecimal(returnAmount),
          balanceBefore: toDecimal(pettyBalanceBefore),
          balanceAfter: toDecimal(pettyBalanceAfter),
          remarks: remarks || 'Returned to bank',
          relatedType: 'BANK',
          relatedId: bankTransaction.id, // Store bankTransaction ID here
        },
      });

      // Update petty cash balance.
      const updatedPettyCash = await tx.pettyCash.update({
        where: { id: pettyCash.id },
        data: {
          currentBalance: toDecimal(pettyBalanceAfter),
          asOnDate: new Date(),
        },
      });

      // Update bank balance
      const updatedBankAccount = await tx.bankDetail.update({
        where: { id: bankAccount.id },
        data: {
          currentBalance: toDecimal(bankBalanceAfter),
          asOnDate: new Date(),
        },
      });

      return {
        status: 200,
        body: {
          success: true,
          message: 'Petty cash successfully returned to bank',
          data: {
            pettyCash: updatedPettyCash,
            bankAccount: updatedBankAccount,
            pettyTransaction,
            bankTransaction: {
              ...bankTransaction,
              type: bankTransactionType,
              paymentMode: paymentMode.name,
            },
          },
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Petty cash return error:', err);
    res.status(500).json({
      success: false,
      message: 'Error returning petty cash',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listPettyCashTransactions
// =============================================================================

export async function listPettyCashTransactions(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      page = '1',
      limit = '10',
      search = '',
      transactionType,
      relatedType,
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      transactionType?: string;
      relatedType?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    // Base where query — strictly scoped to this tenant's petty cash account.
    const where: Prisma.PettyCashTransactionWhereInput = {
      isDeleted: false,
      pettyCash: { userId },
    };

    if (
      transactionType &&
      ['ADD', 'SPEND', 'RETURN'].includes(transactionType)
    ) {
      where.transactionType = transactionType as PettyCashTransactionType;
    }

    if (
      relatedType &&
      ['BANK', 'SUPPLIER_PAYMENT', 'EXPENSE'].includes(relatedType)
    ) {
      where.relatedType = relatedType as PettyCashTransactionRelatedType;
    }

    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate)
        (where.transactionDate as Prisma.DateTimeFilter).gte = new Date(
          startDate,
        );
      if (endDate)
        (where.transactionDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      where.OR = [{ remarks: { contains: search, mode: 'insensitive' } }];
    }

    // Count total for pagination
    const [total, txns] = await Promise.all([
      prisma.pettyCashTransaction.count({ where }),
      prisma.pettyCashTransaction.findMany({
        where,
        orderBy: { transactionDate: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    // Collect BANK-related transaction IDs to enrich with bankTransaction + bankDetail + paymentMode
    const bankRelatedIds = txns
      .filter((t) => t.relatedType === 'BANK')
      .map((t) => t.relatedId);

    const bankTransactions = bankRelatedIds.length
      ? await prisma.bankTransaction.findMany({
          where: { id: { in: bankRelatedIds } },
          include: {
            bankAccount: true,
            paymentMode: true,
          },
        })
      : [];

    const bankTxMap = new Map(bankTransactions.map((bt) => [bt.id, bt]));

    const formatted = txns.map((txn) => {
      const bankTx =
        txn.relatedType === 'BANK' ? bankTxMap.get(txn.relatedId) : undefined;

      // Determine payment mode based on relatedType
      let displayPaymentMode:
        | { id?: string; name: string; slug: string }
        | { name: string; slug: string };

      if (txn.relatedType === 'BANK' && bankTx?.paymentMode) {
        displayPaymentMode = {
          id: bankTx.paymentMode.id,
          name: bankTx.paymentMode.name,
          slug: bankTx.paymentMode.slug,
        };
      } else if (txn.relatedType === 'EXPENSE') {
        displayPaymentMode = { name: 'Petty Cash', slug: 'petty_cash' };
      } else if (txn.relatedType === 'SUPPLIER_PAYMENT') {
        displayPaymentMode = { name: 'Petty Cash', slug: 'petty_cash' };
      } else {
        displayPaymentMode = { name: 'Unknown', slug: 'unknown' };
      }

      // Determine transaction source/details
      let transactionSource:
        | {
            type: string;
            bankInfo?: {
              bankName: string | null;
              accountHolderName: string | null;
              accountNumber: string | null;
              ifscCode: string | null;
            };
            description?: string;
          }
        | { type: string; description: string };

      if (txn.relatedType === 'BANK') {
        const bankDetail = bankTx?.bankAccount;
        transactionSource = {
          type: (bankTx?.type as string) ?? '',
          bankInfo: {
            bankName: bankDetail?.bankName ?? null,
            accountHolderName: bankDetail?.accountHoldername ?? null,
            accountNumber: bankDetail?.accountNumber ?? null,
            ifscCode: bankDetail?.IFSCCode ?? null,
          },
        };
      } else if (txn.relatedType === 'EXPENSE') {
        transactionSource = {
          type: 'EXPENSE_PAYMENT',
          description: 'Expense Payment',
        };
      } else if (txn.relatedType === 'SUPPLIER_PAYMENT') {
        transactionSource = {
          type: 'SUPPLIER_PAYMENT',
          description: 'Supplier Payment',
        };
      } else {
        transactionSource = {
          type: 'OTHER',
          description: 'Other Transaction',
        };
      }

      return {
        id: txn.id,
        transactionDate: txn.transactionDate,
        transactionType: txn.transactionType,
        relatedType: txn.relatedType,
        amount: Number(txn.amount),
        balanceBefore: Number(txn.balanceBefore),
        balanceAfter: Number(txn.balanceAfter),
        remarks: txn.remarks,
        paymentMode: displayPaymentMode,
        transactionSource,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Petty cash transactions fetched successfully',
      data: {
        transactions: formatted,
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
    console.error('List petty cash transactions error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching petty cash transactions',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getFinancialSummary
// =============================================================================

export async function getFinancialSummary(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    // 1) Get total current balances
    const bankAggregate = await prisma.bankDetail.aggregate({
      where: { userId, isDeleted: false, status: true },
      _sum: { currentBalance: true },
    });
    const pettyAggregate = await prisma.pettyCash.aggregate({
      where: { isDeleted: false, userId },
      _sum: { currentBalance: true },
    });

    const bankCurrentBalance = Number(bankAggregate._sum.currentBalance ?? 0);
    const pettyCashCurrentBalance = Number(
      pettyAggregate._sum.currentBalance ?? 0,
    );

    // 2) Chart Data: last 30 days
    const today = dayjs();
    const start30 = today.subtract(29, 'day').startOf('day').toDate();

    const bankTx30Raw = await prisma.bankTransaction.findMany({
      where: { isDeleted: false, transactionDate: { gte: start30 }, bankAccount: { userId } },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, balanceAfter: true },
    });
    const pettyTx30Raw = await prisma.pettyCashTransaction.findMany({
      where: { isDeleted: false, transactionDate: { gte: start30 }, pettyCash: { userId } },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, balanceAfter: true },
    });

    // Group by YYYY-MM-DD, keep the last balanceAfter per day (mirrors Mongo's $last on a sorted pipeline)
    const groupByDay = (
      rows: { transactionDate: Date; balanceAfter: Prisma.Decimal }[],
    ): Map<string, number> => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const key = dayjs(r.transactionDate).format('YYYY-MM-DD');
        map.set(key, Number(r.balanceAfter));
      }
      return map;
    };

    const bankByDay = groupByDay(bankTx30Raw);
    const pettyByDay = groupByDay(pettyTx30Raw);

    const last30Days: { label: string; bank: number; pettyCash: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const dateObj = today.subtract(29 - i, 'day');
      const dateLabel = dateObj.format('D MMM');
      const dateKey = dateObj.format('YYYY-MM-DD');
      const bank = bankByDay.get(dateKey) ?? bankCurrentBalance;
      const petty = pettyByDay.get(dateKey) ?? pettyCashCurrentBalance;

      last30Days.push({
        label: dateLabel,
        bank: Number(bank),
        pettyCash: Number(petty),
      });
    }

    // 3) Chart Data: last 12 months
    const start12 = today.subtract(11, 'month').startOf('month').toDate();

    const bankTx12Raw = await prisma.bankTransaction.findMany({
      where: { isDeleted: false, transactionDate: { gte: start12 }, bankAccount: { userId } },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, balanceAfter: true },
    });
    const pettyTx12Raw = await prisma.pettyCashTransaction.findMany({
      where: { isDeleted: false, transactionDate: { gte: start12 }, pettyCash: { userId } },
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true, balanceAfter: true },
    });

    const groupByMonth = (
      rows: { transactionDate: Date; balanceAfter: Prisma.Decimal }[],
    ): Map<string, number> => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const d = dayjs(r.transactionDate);
        const key = `${d.year()}-${d.month() + 1}`;
        map.set(key, Number(r.balanceAfter));
      }
      return map;
    };

    const bankByMonth = groupByMonth(bankTx12Raw);
    const pettyByMonth = groupByMonth(pettyTx12Raw);

    const last12Months: { label: string; bank: number; pettyCash: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const date = today.subtract(11 - i, 'month');
      const label = date.format('MMM YYYY');
      const month = date.month() + 1;
      const year = date.year();
      const key = `${year}-${month}`;

      const bank = bankByMonth.get(key) ?? bankCurrentBalance;
      const petty = pettyByMonth.get(key) ?? pettyCashCurrentBalance;

      last12Months.push({
        label,
        bank: Number(bank),
        pettyCash: Number(petty),
      });
    }

    // Final Response
    res.status(200).json({
      success: true,
      data: {
        totals: {
          bankCurrentBalance,
          pettyCashCurrentBalance,
        },
        chartData: {
          last30Days,
          last12Months,
        },
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error in getFinancialSummary:', err);
    res.status(500).json({
      success: false,
      message: 'Something went wrong.',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Avoid unused-import lint when only the namespace import is used by tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _scopeRef = tenantScope;

// CommonJS interop for legacy JS routes
module.exports = {
  createPettyCash,
  listPettyCash,
  returnPettyCash,
  listPettyCashTransactions,
  getFinancialSummary,
};
module.exports.createPettyCash = createPettyCash;
module.exports.listPettyCash = listPettyCash;
module.exports.returnPettyCash = returnPettyCash;
module.exports.listPettyCashTransactions = listPettyCashTransactions;
module.exports.getFinancialSummary = getFinancialSummary;
