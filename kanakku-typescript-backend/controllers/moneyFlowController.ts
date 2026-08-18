import type { Request, Response } from 'express';
import { TRANSACTION_TYPES, USER_PAYMENT_REASONS } from '../lib/moneyFlow/types';
import { requireUserId, UnauthorizedError } from '../lib/tenantScope';
import { sendPrismaError } from '../middleware/prismaError';
import { handleLedgerError } from '../lib/httpErrors';
import { explainAndPost, unexplain, ExplainError } from '../lib/moneyFlow/explainPosting';

export async function getTransactionTypes(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ success: true, data: TRANSACTION_TYPES, userPaymentReasons: USER_PAYMENT_REASONS });
}

export async function explain(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const out = await explainAndPost({
      bankTxnId: id,
      userId,
      transactionTypeKey: body.transactionTypeKey as string,
      categoryId: body.categoryId as string | undefined,
      payToUserId: body.payToUserId as string | undefined,
      taxTreatment: body.taxTreatment as string | undefined,
      manualTaxAmount: body.manualTaxAmount as string | number | undefined,
      explainedDescription: body.explainedDescription as string | undefined,
      attachment: body.attachment as string | undefined,
      assetType: body.assetType as string | undefined,
      depreciationMethod: body.depreciationMethod as string | undefined,
      assetLifeMonths: body.assetLifeMonths as number | undefined,
      invoiceId: body.invoiceId as string | undefined,
      billId: body.billId as string | undefined,
      creditNoteId: body.creditNoteId as string | undefined,
      assetId: body.assetId as string | undefined,
      reason: body.reason as string | undefined,
    });
    res.status(200).json({ success: true, data: out });
  } catch (err) {
    if (err instanceof ExplainError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof UnauthorizedError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    // Ledger-domain errors (e.g. PeriodLockedError from a gated post) → 4xx, not 500.
    if (handleLedgerError(res, err)) return;
    sendPrismaError(res, err);
  }
}

export async function unexplainTxn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    await unexplain({ bankTxnId: id, userId });
    res.status(200).json({ success: true, message: 'Transaction un-explained' });
  } catch (err) {
    if (err instanceof ExplainError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    if (err instanceof UnauthorizedError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    // voidDocument now enforces the period lock; a locked-period unexplain throws
    // PeriodLockedError → map to 423, not a generic 500.
    if (handleLedgerError(res, err)) return;
    sendPrismaError(res, err);
  }
}

module.exports = { getTransactionTypes, explain, unexplainTxn };
module.exports.getTransactionTypes = getTransactionTypes;
module.exports.explain = explain;
module.exports.unexplainTxn = unexplainTxn;
