// controllers/accountCreditController.ts
//
// Per-contact "Account Credit": grant/void a manually-issued credit balance
// (goodwill, timely-payment bonus, promo) that a customer can later redeem
// against a future invoice. Redemption itself (and its validation against the
// invoice-payment flow) is owned by a separate, parallel task — this file only
// covers granting a credit and voiding an un-redeemed grant.
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireUserId, requireActingUserId, UnauthorizedError } from '../lib/tenantScope';
import { handleLedgerError } from '../lib/httpErrors';
import { post, type LedgerTx } from '../lib/ledger/postingEngine';
import { voidDocument, type PostingTx } from '../lib/ledger/ledgerPosting';
import { getAccountCreditBalance, type AccountCreditBalanceDb } from '../lib/contacts/accountCreditBalance';

type Tx = Prisma.TransactionClient;

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// C.1: resolve the company default currency code (ISO string). Mirrors the
// same helper already duplicated across every contact-scoped money controller
// in this codebase (customerController, debitNoteController, etc.).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

interface GrantBody {
  amount?: unknown;
  reason?: unknown;
}

interface VoidBody {
  reason?: unknown;
}

/** POST /admin/contacts/:id/credits — grant a positive credit to a contact. */
export async function grantAccountCredit(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const actingUserId = requireActingUserId(req);
    const contactId = req.params.id as string;
    const body = (req.body ?? {}) as GrantBody;

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ success: false, message: 'amount must be a positive number.' });
      return;
    }
    const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason : null;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, userId, isDeleted: false },
      select: { id: true, currencyCode: true },
    });
    if (!contact) {
      res.status(404).json({ success: false, message: 'Contact not found.' });
      return;
    }

    const currencyCode = contact.currencyCode ?? (await resolveDefaultCurrencyCode());
    const amountDecimal = new Prisma.Decimal(amount);
    const now = new Date();

    const result = await prisma.$transaction(async (tx: Tx) => {
      const entry = await tx.accountCreditEntry.create({
        data: {
          userId,
          contactId,
          type: 'GRANT',
          amount: amountDecimal,
          reason,
          currencyCode,
          createdById: actingUserId,
        },
      });

      await post(tx as unknown as LedgerTx, {
        userId,
        sourceType: 'AccountCreditEntry',
        sourceId: entry.id,
        event: 'grant',
        date: now,
        currencyCode: currencyCode ?? 'BASE',
        description: reason ?? 'Account credit granted',
        instructions: [
          { roleKey: 'CUSTOMER_CREDIT_EXPENSE', side: 'debit', amount: amountDecimal.toString() },
          { roleKey: 'ACCOUNT_CREDIT', side: 'credit', amount: amountDecimal.toString() },
        ],
      });

      const balance = await getAccountCreditBalance(tx as unknown as AccountCreditBalanceDb, { userId, contactId });
      return { entry, balance };
    });

    res.status(201).json({
      success: true,
      data: { entry: result.entry, balance: Number(result.balance) },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Grant account credit error:', err);
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Error granting account credit',
    });
  }
}

/** DELETE /admin/contacts/:id/credits/:entryId — void an un-redeemed grant. */
export async function voidAccountCredit(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const actingUserId = requireActingUserId(req);
    const contactId = req.params.id as string;
    const entryId = req.params.entryId as string;
    const body = (req.body ?? {}) as VoidBody;
    const voidReason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason : null;

    const entry = await prisma.accountCreditEntry.findFirst({
      where: { id: entryId, userId, contactId },
    });
    if (!entry || entry.type !== 'GRANT' || entry.isVoided) {
      res.status(404).json({ success: false, message: 'Account credit grant not found.' });
      return;
    }

    // Guard against negative balance: if more has already been redeemed than
    // would remain after removing this grant, refuse the void outright.
    const currentBalance = await getAccountCreditBalance(prisma as unknown as AccountCreditBalanceDb, { userId, contactId });
    const balanceAfterVoid = currentBalance.minus(entry.amount);
    if (balanceAfterVoid.lessThan(0)) {
      res.status(400).json({
        success: false,
        message: 'Cannot void — this credit (or part of it) has already been redeemed against an invoice.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      await voidDocument(tx as unknown as PostingTx, { userId, sourceType: 'AccountCreditEntry', sourceId: entry.id, event: 'grant' });
      await tx.accountCreditEntry.update({
        where: { id: entry.id },
        data: { isVoided: true, voidedById: actingUserId, voidedAt: new Date(), voidReason },
      });
      const balance = await getAccountCreditBalance(tx as unknown as AccountCreditBalanceDb, { userId, contactId });
      return { balance };
    });

    res.json({ success: true, data: { balance: Number(result.balance) } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    if (handleLedgerError(res, err)) return;
    console.error('Void account credit error:', err);
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Error voiding account credit',
    });
  }
}
