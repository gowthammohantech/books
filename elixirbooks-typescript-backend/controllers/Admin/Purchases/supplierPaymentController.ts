import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type {
  SupplierPaymentSourceType,
  PurchaseStatus,
} from '@prisma/client';
import { validationResult } from 'express-validator';

import { prisma } from '../../../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../../../lib/tenantScope';
import { resolveDisplayName } from '../../../lib/contacts/contactIdentity';
import { handleLedgerError } from '../../../lib/httpErrors';
import {
  nextDocumentNumber,
  withDocumentNumberRetry,
  handleNumberConflict,
  type NumberingModel,
} from '../../../lib/documentNumbering';
import {
  postSupplierPayment,
  voidDocument,
  type PostingTx,
} from '../../../lib/ledger/ledgerPosting';
import { resolveBankGlAccountId } from '../../../lib/ledger/bankAccount';
import { toBaseAmount } from '../../../lib/ledger/money';
import {
  reverseSupplierPaymentEffects,
  type PaymentEffectsTx,
} from '../../../lib/ledger/voidPaymentEffects';
import { explainedBankFields } from '../../../lib/moneyFlow/explainedBankFields';
import { shouldPost } from '../../../lib/ledger/postingGate';

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

/**
 * P0-4 (Task 6, fix round 1): the overpayment guard must run INSIDE the same
 * transaction as the aggregate it decides from (and the write it gates),
 * otherwise two concurrent payment requests can both read the same
 * pre-write sum, both pass the check, and jointly overpay the purchase
 * (TOCTOU). Thrown from inside `prisma.$transaction`/`tx`, caught here and
 * mapped to 400 — mirrors the `UnauthorizedError` convention above.
 */
class OverpaymentError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'OverpaymentError';
  }
}

function handleOverpayment(res: Response, err: unknown): boolean {
  if (err instanceof OverpaymentError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
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

function formatDateShort(d: Date | null | undefined): string | null {
  if (!d) return null;
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleString('default', { month: 'short' });
  return `${day}, ${month} ${d.getFullYear()}`;
}

function generateNextPaymentNumber(
  tx: Tx,
  userId: string,
  prefix = 'PAY-',
): Promise<string> {
  return nextDocumentNumber({
    model: tx.supplierPayment as unknown as NumberingModel,
    field: 'paymentId',
    prefix,
    tenantWhere: { purchase: { userId } },
  });
}

// =============================================================================
// createSupplierPayment
// =============================================================================

export async function createSupplierPayment(
  req: Request,
  res: Response,
): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array(),
    });
    return;
  }

  try {
    const userId = requireUserId(req);
    const {
      purchaseId,
      contactId,
      referenceNumber,
      paymentDate,
      paymentMode,
      amount,
      paidAmount,
      dueAmount,
      notes,
      sourceType,
      bankId,
    } = req.body as {
      purchaseId?: string;
      contactId?: string;
      referenceNumber?: string;
      paymentDate?: string;
      paymentMode?: string;
      amount?: number | string;
      paidAmount?: number | string;
      dueAmount?: number | string;
      notes?: string;
      sourceType?: string;
      bankId?: string;
    };

    // Verify the purchase is tenant-owned before referencing it anywhere below.
    const purchase = await prisma.purchase.findFirst({
      where: { id: purchaseId, userId, isDeleted: false },
    });
    if (!purchase) {
      res.status(404).json({ success: false, message: 'Purchase not found' });
      return;
    }

    // AP integrity guard: the bill's AP credit is posted only once the purchase
    // is approved/posted. When approvals are enabled, createPurchase defers GL
    // posting to approvePurchase (approvalStatus PENDING gate — see
    // purchaseController). Recording a payment against a PENDING (awaiting
    // approval) or REJECTED purchase would post an AP *debit* with no matching
    // bill *credit*, which surfaces as a spurious negative AP-aging balance.
    // Require the bill to be posted first.
    if (purchase.approvalStatus === 'PENDING') {
      res.status(400).json({
        success: false,
        message: 'This purchase is awaiting approval. Approve it before recording a payment.',
      });
      return;
    }
    if (purchase.approvalStatus === 'REJECTED') {
      res.status(400).json({
        success: false,
        message: 'This purchase was rejected and cannot be paid.',
      });
      return;
    }

    // Verify the contact is tenant-owned; keep name fields for remarks.
    let resolvedContactName: string | null = null;
    if (contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, userId, isDeleted: false },
        select: { id: true, firstName: true, lastName: true, organisation: true },
      });
      if (!contact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
      resolvedContactName = resolveDisplayName(contact) || null;
    }

    // Party inheritance: without this, a payment created without an explicit
    // body.contactId would be saved with contactId=null AND supplierId=null
    // even though its purchase carries a real party — the payment then shows
    // as "Deleted User" in the list (listSupplierPayments falls back to the
    // purchase's party for pre-existing orphaned rows, but new rows should
    // simply never be orphaned). Prefer the explicit body contactId; else
    // inherit the purchase's contactId; else fall back to the purchase's
    // legacy supplierId only when neither contactId is available.
    const resolvedContactId = contactId ?? purchase.contactId ?? null;
    const resolvedSupplierId = resolvedContactId ? null : purchase.supplierId ?? null;

    // G: payment-date currency/rate (optional — absent → functional path)
    const bodyRaw = req.body as Record<string, unknown>;
    const pmtCurrencyCode = typeof bodyRaw.currencyCode === 'string' && bodyRaw.currencyCode ? bodyRaw.currencyCode : undefined;
    const pmtExchangeRate = bodyRaw.exchangeRate != null ? toDecimal(bodyRaw.exchangeRate) : undefined;

    const attachment = req.file ? `uploads/${req.file.filename}` : null;

    if (!sourceType || !['BANK', 'PETTY_CASH'].includes(sourceType)) {
      res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: {
          sourceType: 'Invalid source type. Must be BANK or PETTY_CASH.',
        },
      });
      return;
    }

    const paidAmountNum = asNumber(paidAmount, 0);

    // FX: the cash register (bankDetail/pettyCash.currentBalance) is base-currency,
    // so it must move by the base value of the payment — never the raw foreign
    // amount. registerRate is the payment-date rate (falling back to the bill's
    // document rate), matching the GL cash leg (cashBase = amount × payRate). It is
    // persisted on the SupplierPayment row so void/delete refunds the same base.
    const isForeignPmt = !!pmtCurrencyCode && pmtCurrencyCode !== 'BASE';
    const registerRate: Prisma.Decimal | null = isForeignPmt
      ? (pmtExchangeRate ?? purchase.exchangeRate ?? new Prisma.Decimal(1))
      : null;
    const paidBaseAmount = toBaseAmount(paidAmountNum, registerRate);

    // P0-4 (Task 6): server-authoritative due tracking. The client-sent
    // `dueAmount` is accepted for compatibility but IGNORED for state decisions.
    // Real remaining-due total; the aggregate over existing payments that this
    // is compared against is computed INSIDE the transaction below (fix round 1
    // — see OverpaymentError) so the check and the write are atomic.
    const purchaseTotalDec = new Prisma.Decimal(String(purchase.totalAmount ?? 0));

    // BANK requires bankId and paymentMode
    if (sourceType === 'BANK') {
      if (!bankId) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { bankId: 'Bank ID is required for BANK payments.' },
        });
        return;
      }
      if (!paymentMode) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { paymentMode: 'Payment mode is required for BANK payments.' },
        });
        return;
      }

      const bank = await prisma.bankDetail.findFirst({ where: { id: bankId, userId } });
      if (!bank) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { bankId: 'Bank not found.' },
        });
        return;
      }

      const currentBalance = Number(bank.currentBalance ?? 0);
      if (paidBaseAmount > currentBalance) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: {
            bankId: `Insufficient balance, current balance is ${currentBalance}`,
          },
        });
        return;
      }
    }

    // PETTY_CASH balance check
    if (sourceType === 'PETTY_CASH') {
      const pettyCash = await prisma.pettyCash.findFirst({
        where: { userId, isDeleted: false },
      });
      if (!pettyCash) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: { sourceType: 'Petty cash not found.' },
        });
        return;
      }

      const currentBalance = Number(pettyCash.currentBalance ?? 0);
      if (paidBaseAmount > currentBalance) {
        res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors: {
            sourceType: `Insufficient balance, current balance is ${currentBalance}`,
          },
        });
        return;
      }
    }

    const result = await withDocumentNumberRetry('paymentId', () => prisma.$transaction(async (tx) => {
      // P0-4 (Task 6, fix round 1): aggregate + overpayment guard run INSIDE
      // the transaction, atomically with the write below — closes the TOCTOU
      // window where two concurrent payments could both read the same
      // pre-write sum and jointly overpay (0.005 rounding tolerance — mirrors
      // lib/ledger/applyBillPayment.ts).
      const priorPaidAgg = await tx.supplierPayment.aggregate({
        where: { purchaseId: purchase.id, isVoided: false, isDeleted: false },
        _sum: { paidAmount: true },
      });
      const priorPaidDec = new Prisma.Decimal(String(priorPaidAgg._sum.paidAmount ?? 0));
      const remainingDueDec = purchaseTotalDec.minus(priorPaidDec);
      if (new Prisma.Decimal(paidAmountNum).greaterThan(remainingDueDec.plus(0.005))) {
        throw new OverpaymentError(
          `Payment amount ${paidAmountNum} exceeds the remaining due of ${remainingDueDec.toFixed(2)}.`,
        );
      }

      const paymentId = await generateNextPaymentNumber(tx, userId);

      const savedPayment = await tx.supplierPayment.create({
        data: {
          paymentId,
          purchaseId: purchaseId as string,
          contactId: resolvedContactId,
          supplierId: resolvedSupplierId,
          referenceNumber: referenceNumber ?? null,
          paymentDate: safeDate(paymentDate) ?? new Date(),
          paymentModeId:
            sourceType === 'BANK' ? (paymentMode as string) : null,
          amount: asNumber(amount, 0),
          paidAmount: paidAmountNum,
          dueAmount: asNumber(dueAmount, 0),
          notes: notes ?? null,
          attachment,
          createdBy: userId,
          sourceType: sourceType as SupplierPaymentSourceType,
          bankId: sourceType === 'BANK' ? (bankId as string) : null,
          // Record path: both the BANK and PETTY_CASH blocks below MOVE a cash
          // register (bankDetail / pettyCash currentBalance), so the delete/void
          // reversal must undo it. Contrast the explain flow (applyBillPayment),
          // which leaves this false because the imported line already owns the money.
          movedBankBalance: true,
          // G: persist payment-date currency/rate. Persist the effective register
          // rate (payment rate, falling back to the bill rate) whenever foreign so
          // the void/delete path refunds the exact base amount deducted here.
          ...(pmtCurrencyCode ? { currencyCode: pmtCurrencyCode } : {}),
          ...(registerRate != null ? { exchangeRate: registerRate } : {}),
        },
      });

      // Whether the SupplierPayment JE actually posts under the go-live gate
      // (same settings/date the postSupplierPayment → gatedPost call below uses).
      // The bank line is reconciled iff that JE truly posts.
      const ledgerSettings = await tx.companySettings.findFirst({ where: { userId } });
      const didPostPayment = shouldPost(
        ledgerSettings,
        savedPayment.paymentDate ?? new Date(),
      );

      if (sourceType === 'BANK') {
        const bank = await tx.bankDetail.findFirst({
          where: { id: bankId as string, userId },
        });
        if (!bank) throw new Error('BANK_NOT_FOUND');

        const balanceBefore = Number(bank.currentBalance ?? 0);
        const balanceAfter = Number(
          (balanceBefore - paidBaseAmount).toFixed(2),
        );

        await tx.bankDetail.update({
          where: { id: bank.id },
          data: { currentBalance: toDecimal(balanceAfter) },
        });

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bank.id,
            transactionDate: new Date(),
            type: 'TRANSFER_OUT',
            amount: toDecimal(paidBaseAmount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            paymentModeId: paymentMode as string,
            referenceNo: referenceNumber || null,
            remarks: notes || `Supplier payment to ${resolvedContactName ?? contactId}`,
            relatedType: 'SUPPLIER_PAYMENT',
            relatedId: savedPayment.id,
            // Banking A2: linked to the posted SupplierPayment → auto-explain + reconcile.
            // Reconciled iff the JE actually posts under the go-live gate.
            ...explainedBankFields({
              postedSourceType: 'SupplierPayment',
              postedSourceId: savedPayment.id,
              posted: didPostPayment,
              approvedById: userId,
              approvedAt: new Date(),
            }),
          },
        });
      } else if (sourceType === 'PETTY_CASH') {
        const pettyCash = await tx.pettyCash.findFirst({
          where: { userId, isDeleted: false },
        });
        if (!pettyCash) throw new Error('PETTY_CASH_NOT_FOUND');

        const balanceBefore = Number(pettyCash.currentBalance ?? 0);
        const balanceAfter = Number(
          (balanceBefore - paidBaseAmount).toFixed(2),
        );

        await tx.pettyCash.update({
          where: { id: pettyCash.id },
          data: { currentBalance: toDecimal(balanceAfter) },
        });

        await tx.pettyCashTransaction.create({
          data: {
            pettyCashId: pettyCash.id,
            transactionDate: new Date(),
            transactionType: 'SPEND',
            amount: toDecimal(paidBaseAmount),
            balanceBefore: toDecimal(balanceBefore),
            balanceAfter: toDecimal(balanceAfter),
            remarks: notes || `Supplier payment to ${resolvedContactName ?? contactId}`,
            relatedType: 'SUPPLIER_PAYMENT',
            relatedId: savedPayment.id,
          },
        });
      }

      // P0-4: derive purchase status + paid/balance from the server-computed
      // remainder (prior payments + this one), never the client `dueAmount`.
      const newPaidDec = priorPaidDec.plus(paidAmountNum);
      const newBalanceDec = purchaseTotalDec.minus(newPaidDec);
      const purchaseStatus: PurchaseStatus = newBalanceDec.lessThanOrEqualTo(0.005)
        ? 'paid'
        : newPaidDec.greaterThan(0.005)
          ? 'partially_paid'
          : 'pending';

      await tx.purchase.update({
        where: { id: purchaseId as string },
        data: {
          status: purchaseStatus,
          paidAmount: newPaidDec,
          balanceAmount: newBalanceDec.lessThan(0) ? new Prisma.Decimal(0) : newBalanceDec,
        },
      });

      // GL: post the supplier payment (Dr AP, Cr BANK/CASH) — FX-aware when currency provided.
      {
        // Resolve payment mode slug when source is BANK
        let paymentModeSlug: string | null = null;
        if (sourceType === 'BANK' && paymentMode) {
          const pmDoc = await tx.paymentMode.findUnique({
            where: { id: paymentMode as string },
            select: { slug: true },
          });
          paymentModeSlug = pmDoc?.slug ?? null;
        }

        // G: derive documentRate from parent purchase (the rate at which AP was originally booked).
        // paymentRate: rate at payment date (pmtExchangeRate ?? documentRate).
        let documentRate: Prisma.Decimal | undefined;
        let paymentRate: Prisma.Decimal | undefined;
        if (pmtCurrencyCode) {
          documentRate = purchase.exchangeRate ?? new Prisma.Decimal(1);
          paymentRate = pmtExchangeRate ?? documentRate;
        }

        const bankGlAccountId = sourceType === 'BANK'
          ? await resolveBankGlAccountId(tx as never, bankId as string)
          : null;
        await postSupplierPayment(tx as unknown as PostingTx, {
          userId,
          purchaseId: purchaseId as string,
          paymentId: savedPayment.id,
          date: savedPayment.paymentDate ?? new Date(),
          amount: String(paidAmountNum),
          sourceType: sourceType ?? null,
          paymentModeSlug,
          bankGlAccountId,
          ...(pmtCurrencyCode ? { currencyCode: pmtCurrencyCode, paymentRate, documentRate } : {}),
        });
      }

      return { savedPayment, purchaseStatus };
    }));

    const sp = result.savedPayment;
    res.status(201).json({
      success: true,
      message: 'Supplier payment created successfully',
      data: {
        payment: {
          ...sp,
          amount: Number(sp.amount),
          paidAmount: Number(sp.paidAmount),
          dueAmount: Number(sp.dueAmount),
        },
        updatedPurchaseStatus: result.purchaseStatus,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleOverpayment(res, err)) return;
    if (handleLedgerError(res, err)) return;
    if (handleNumberConflict(res, err, 'paymentId')) return;
    console.error('Error creating supplier payment:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating supplier payment',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// listSupplierPayments
// =============================================================================

export async function listSupplierPayments(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      supplierId,
      contactId: contactIdFilter,
      sourceType,
      startDate,
      endDate,
      search = '',
    } = req.query as {
      page?: string;
      limit?: string;
      supplierId?: string;
      contactId?: string;
      sourceType?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const where: Prisma.SupplierPaymentWhereInput = {
      isDeleted: false,
      purchase: { userId },
    };

    if (contactIdFilter) {
      where.contactId = contactIdFilter;
    } else if (supplierId) {
      where.supplierId = supplierId;
    }
    if (sourceType && ['BANK', 'PETTY_CASH'].includes(sourceType)) {
      where.sourceType = sourceType as SupplierPaymentSourceType;
    }
    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate)
        (where.paymentDate as Prisma.DateTimeFilter).gte = new Date(startDate);
      if (endDate)
        (where.paymentDate as Prisma.DateTimeFilter).lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { paymentId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, payments] = await Promise.all([
      prisma.supplierPayment.count({ where }),
      prisma.supplierPayment.findMany({
        where,
        include: {
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
          supplier: {
            select: {
              id: true,
              supplier_name: true,
              supplier_email: true,
              supplier_phone: true,
              profileImage: true,
            },
          },
          purchase: {
            select: {
              id: true,
              purchaseId: true,
              totalAmount: true,
              purchaseDate: true,
              currencyCode: true,
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
              supplier: {
                select: {
                  id: true,
                  supplier_name: true,
                  supplier_email: true,
                  supplier_phone: true,
                  profileImage: true,
                },
              },
            },
          },
          paymentMode: { select: { id: true, name: true } },
          bank: {
            select: {
              id: true,
              bankName: true,
              accountNumber: true,
              accountHoldername: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitN,
      }),
    ]);

    const baseUrl = buildBaseUrl(req);

    const formattedPayments = payments.map((p) => {
      // Contact-first party resolution: prefer the payment's own unified Contact,
      // then its legacy Supplier, then fall back to the PURCHASE's party — a
      // payment can be created without a direct contactId/supplierId (e.g. when
      // the client omitted body.contactId), in which case the purchase it pays
      // down still carries the real party and should be shown instead of
      // "Deleted User".
      const directContact = p.contact ?? p.purchase?.contact ?? null;
      const directSupplier = p.supplier ?? p.purchase?.supplier ?? null;
      const supplier = directContact
        ? {
            id: directContact.id,
            name: resolveDisplayName(directContact),
            email: directContact.email || null,
            phone: directContact.mobile || directContact.telephone || null,
            profileImage: directContact.image
              ? `${baseUrl}${directContact.image.replace(/\\/g, '/')}`
              : '',
          }
        : directSupplier
          ? {
              id: directSupplier.id,
              name: directSupplier.supplier_name || '',
              email: directSupplier.supplier_email || null,
              phone: directSupplier.supplier_phone || null,
              profileImage: directSupplier.profileImage
                ? `${baseUrl}${directSupplier.profileImage.replace(/\\/g, '/')}`
                : '',
            }
          : null;

      const purchase = p.purchase
        ? {
            id: p.purchase.id,
            purchaseId: p.purchase.purchaseId,
            totalAmount: p.purchase.totalAmount,
            purchaseDate: formatDateShort(p.purchase.purchaseDate),
            currencyCode: p.purchase.currencyCode ?? null,
          }
        : null;

      let attachmentUrl: string | null = null;
      if (p.attachment) {
        const cleanPath = p.attachment.replace(/\\/g, '/');
        attachmentUrl = cleanPath.startsWith('http')
          ? cleanPath
          : `${baseUrl}${cleanPath}`;
      }

      const bank =
        p.sourceType === 'BANK' && p.bank
          ? {
              id: p.bank.id,
              bankName: p.bank.bankName,
              accountNumber: p.bank.accountNumber,
              accountHolder: p.bank.accountHoldername,
            }
          : null;

      return {
        id: p.id,
        paymentId: p.paymentId,
        referenceNumber: p.referenceNumber,
        paymentDate: formatDateShort(p.paymentDate),
        sourceType: p.sourceType,
        amount: Number(p.amount),
        paidAmount: Number(p.paidAmount),
        dueAmount: Number(p.dueAmount),
        currencyCode: p.currencyCode ?? p.purchase?.currencyCode ?? null,
        notes: p.notes,
        attachment: attachmentUrl,
        supplier,
        purchase,
        bank,
        paymentMode: p.paymentMode ? p.paymentMode.name : null,
        createdAt: formatDateShort(p.createdAt),
        updatedAt: formatDateShort(p.updatedAt),
      };
    });

    res.status(200).json({
      success: true,
      message: 'Supplier payments retrieved successfully',
      data: {
        payments: formattedPayments,
        pagination: {
          total,
          page: pageN,
          limit: limitN,
          totalPages: Math.ceil(total / limitN),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching supplier payments:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching supplier payments',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// updateSupplierPayment
// =============================================================================

export async function updateSupplierPayment(
  req: Request,
  res: Response,
): Promise<void> {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      message: 'Validation failed',
      errors: errors.array(),
    });
    return;
  }

  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const {
      purchaseId,
      contactId,
      referenceNumber,
      paymentDate,
      paymentMode,
      amount,
      paidAmount,
      dueAmount,
      notes,
    } = req.body as {
      purchaseId?: string;
      contactId?: string;
      referenceNumber?: string;
      paymentDate?: string;
      paymentMode?: string;
      amount?: number | string;
      paidAmount?: number | string;
      dueAmount?: number | string;
      notes?: string;
    };

    const existingPayment = await prisma.supplierPayment.findFirst({
      where: { id, isDeleted: false, purchase: { userId } },
    });
    if (!existingPayment) {
      res.status(404).json({
        success: false,
        message: 'Supplier payment not found',
      });
      return;
    }

    // Validate tenant ownership of purchaseId when the caller is re-pointing the payment.
    if (purchaseId && purchaseId !== existingPayment.purchaseId) {
      const targetPurchase = await prisma.purchase.findFirst({
        where: { id: purchaseId, userId, isDeleted: false },
      });
      if (!targetPurchase) {
        res.status(404).json({ success: false, message: 'Purchase not found' });
        return;
      }
    }

    // Validate tenant ownership of contactId when provided
    if (contactId) {
      const contact = await prisma.contact.findFirst({
        where: { id: contactId, userId, isDeleted: false },
        select: { id: true },
      });
      if (!contact) {
        res.status(404).json({ success: false, message: 'Contact not found' });
        return;
      }
    }

    let attachment = existingPayment.attachment;
    if (req.file) {
      attachment = `uploads/${req.file.filename}`;
    }

    const newPaidAmount = asNumber(paidAmount, Number(existingPayment.paidAmount));
    const newDueAmount = asNumber(dueAmount, Number(existingPayment.dueAmount));
    const effectivePurchaseId = (purchaseId as string) ?? existingPayment.purchaseId;

    const txResult = await prisma.$transaction(async (tx) => {
      // P0-4 (Task 6, fix round 1): server-authoritative due — reject
      // overpayment and derive the purchase status/paid/balance from the real
      // remainder (server total − sum of the OTHER non-voided/deleted
      // payments), ignoring the client `dueAmount`. The total fetch, the
      // aggregate, and the guard all run INSIDE the transaction, atomically
      // with the write below — closes the TOCTOU window where two concurrent
      // updates could both read the same pre-write sum and jointly overpay.
      const effPurchase = await tx.purchase.findFirst({
        where: { id: effectivePurchaseId, userId, isDeleted: false },
        select: { totalAmount: true, contactId: true, supplierId: true },
      });
      const effTotalDec = new Prisma.Decimal(String(effPurchase?.totalAmount ?? 0));

      // Party inheritance on edit: prefer an explicit body contactId; else
      // keep the payment's own existing contactId (never null out a real
      // party on edit); else inherit from the (possibly re-pointed) purchase
      // — this heals orphaned payments (no direct party) the next time
      // they're touched, without ever discarding a party that's already set.
      const resolvedContactId =
        contactId ?? existingPayment.contactId ?? effPurchase?.contactId ?? null;
      const resolvedSupplierId = resolvedContactId
        ? null
        : existingPayment.supplierId ?? effPurchase?.supplierId ?? null;
      const otherPaidAgg = await tx.supplierPayment.aggregate({
        where: { purchaseId: effectivePurchaseId, isVoided: false, isDeleted: false, id: { not: id } },
        _sum: { paidAmount: true },
      });
      const otherPaidDec = new Prisma.Decimal(String(otherPaidAgg._sum.paidAmount ?? 0));
      const remainingForThisDec = effTotalDec.minus(otherPaidDec);
      if (new Prisma.Decimal(newPaidAmount).greaterThan(remainingForThisDec.plus(0.005))) {
        throw new OverpaymentError(
          `Payment amount ${newPaidAmount} exceeds the remaining due of ${remainingForThisDec.toFixed(2)}.`,
        );
      }
      const derivedPaidDec = otherPaidDec.plus(newPaidAmount);
      const derivedBalanceDec = effTotalDec.minus(derivedPaidDec);
      const derivedStatus: PurchaseStatus = derivedBalanceDec.lessThanOrEqualTo(0.005)
        ? 'paid'
        : derivedPaidDec.greaterThan(0.005)
          ? 'partially_paid'
          : 'pending';

      const upd = await tx.supplierPayment.update({
        where: { id },
        data: {
          purchaseId: purchaseId ?? existingPayment.purchaseId,
          contactId: resolvedContactId,
          supplierId: resolvedSupplierId,
          referenceNumber: referenceNumber ?? existingPayment.referenceNumber,
          paymentDate:
            safeDate(paymentDate) ?? existingPayment.paymentDate,
          paymentModeId: paymentMode ?? existingPayment.paymentModeId,
          amount: asNumber(amount, Number(existingPayment.amount)),
          paidAmount: newPaidAmount,
          dueAmount: newDueAmount,
          notes: notes ?? existingPayment.notes,
          attachment,
        },
      });

      await tx.purchase.update({
        where: { id: effectivePurchaseId },
        data: {
          status: derivedStatus,
          paidAmount: derivedPaidDec,
          balanceAmount: derivedBalanceDec.lessThan(0) ? new Prisma.Decimal(0) : derivedBalanceDec,
        },
      });

      // GL: void old payment entry and re-post with updated amount
      await voidDocument(tx as unknown as PostingTx, {
        userId,
        sourceType: 'SupplierPayment',
        sourceId: id,
        event: 'payment',
      });
      {
        let paymentModeSlug: string | null = null;
        const effectivePaymentModeId = paymentMode ?? existingPayment.paymentModeId;
        if (upd.sourceType === 'BANK' && effectivePaymentModeId) {
          const pmDoc = await tx.paymentMode.findUnique({
            where: { id: effectivePaymentModeId },
            select: { slug: true },
          });
          paymentModeSlug = pmDoc?.slug ?? null;
        }
        const bankGlAccountId = upd.sourceType === 'BANK'
          ? await resolveBankGlAccountId(tx as never, upd.bankId ?? null)
          : null;
        await postSupplierPayment(tx as unknown as PostingTx, {
          userId,
          purchaseId: upd.purchaseId ?? existingPayment.purchaseId,
          paymentId: upd.id,
          date: upd.paymentDate ?? new Date(),
          amount: String(newPaidAmount),
          sourceType: upd.sourceType ?? null,
          paymentModeSlug,
          bankGlAccountId,
        });
      }

      return { payment: upd, derivedStatus };
    });

    const updatedPayment = txResult.payment;
    const derivedStatus = txResult.derivedStatus;

    const samePurchase =
      (purchaseId ?? existingPayment.purchaseId) === existingPayment.purchaseId;

    res.status(200).json({
      success: true,
      message: 'Supplier payment updated successfully',
      data: {
        payment: {
          ...updatedPayment,
          amount: Number(updatedPayment.amount),
          paidAmount: Number(updatedPayment.paidAmount),
          dueAmount: Number(updatedPayment.dueAmount),
        },
        ...(samePurchase && {
          updatedPurchaseStatus: derivedStatus,
        }),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleOverpayment(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Error updating supplier payment:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating supplier payment',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// deleteSupplierPayment
// =============================================================================

export async function deleteSupplierPayment(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.supplierPayment.findFirst({
      where: { id, isDeleted: false, purchase: { userId } },
      select: { id: true, purchaseId: true },
    });
    if (!existing) {
      res.status(404).json({ message: 'Supplier payment not found' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Reload the payment (scoped via its purchase) WITH the bank relation so
      // the shared reversal can restore the correct cash source.
      const payment = await tx.supplierPayment.findFirst({
        where: { id, isDeleted: false, purchase: { userId } },
        include: { bank: true, purchase: true },
      });
      if (!payment) return; // vanished under us — nothing to reverse

      // Restore the cash source (bank OR petty cash), reverse the payment JE and
      // write a reversing txn — the SAME effects voidSupplierPayment applies.
      // Previously the delete reversed the GL only, so the bank/petty balance
      // stayed reduced and the reversing txn was never written.
      await reverseSupplierPaymentEffects(tx as unknown as PaymentEffectsTx, {
        userId,
        payment,
        remarks: `Reversal of deleted supplier payment ${payment.id}`,
      });

      await tx.supplierPayment.delete({ where: { id } });

      // Recompute purchase status / paidAmount / balanceAmount from the REMAINING
      // non-voided, non-deleted payments — never force `partially_paid`. With no
      // payments left the purchase returns to `pending` (unpaid) semantics.
      try {
        const purchase = payment.purchase;
        const totalDec = new Prisma.Decimal(String(purchase?.totalAmount ?? 0));
        const paidAgg = await tx.supplierPayment.aggregate({
          where: { purchaseId: payment.purchaseId, isVoided: false, isDeleted: false },
          _sum: { paidAmount: true },
        });
        const paidDec = new Prisma.Decimal(String(paidAgg._sum.paidAmount ?? 0));
        const balanceDec = totalDec.minus(paidDec);
        const status: PurchaseStatus = balanceDec.lessThanOrEqualTo(0.005)
          ? 'paid'
          : paidDec.greaterThan(0.005)
            ? 'partially_paid'
            : 'pending';

        await tx.purchase.update({
          where: { id: payment.purchaseId },
          data: {
            status,
            paidAmount: paidDec,
            balanceAmount: balanceDec.lessThan(0) ? new Prisma.Decimal(0) : balanceDec,
          },
        });
      } catch (e) {
        console.warn(
          `Purchase ${payment.purchaseId} not found, but payment was deleted`,
          e,
        );
      }
    });

    res.status(200).json({
      success: true,
      message: 'Supplier payment deleted successfully and purchase status updated',
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    res.status(500).json({
      message: 'Error deleting supplier payment',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Avoid unused-import lint when only the namespace import is used by tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _scopeRef = tenantScope;

// CommonJS interop for legacy JS routes
module.exports = {
  createSupplierPayment,
  listSupplierPayments,
  updateSupplierPayment,
  deleteSupplierPayment,
};
module.exports.createSupplierPayment = createSupplierPayment;
module.exports.listSupplierPayments = listSupplierPayments;
module.exports.updateSupplierPayment = updateSupplierPayment;
module.exports.deleteSupplierPayment = deleteSupplierPayment;
