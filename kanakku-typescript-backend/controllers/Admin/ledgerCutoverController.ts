import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireUserId } from '../../lib/tenantScope';
import { previewCutover, commitCutover, type CutoverTx } from '../../lib/ledger/cutover';
import { LedgerError } from '../../lib/ledger/buildLines';
import { handleLedgerError } from '../../lib/httpErrors';

export async function previewCutoverHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const r = await prisma.$transaction((tx) => previewCutover(tx as unknown as CutoverTx, userId));
    res.json({ success: true, data: r });
  } catch (err) {
    if (handleLedgerError(res, err)) return;
    if (err instanceof LedgerError) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    const name = (err as { name?: string })?.name;
    if (name === 'UnauthorizedError') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    console.error('previewCutover error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview cutover' });
  }
}

export async function commitCutoverHandler(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const r = await prisma.$transaction((tx) => commitCutover(tx as unknown as CutoverTx, userId));
    res.json({
      success: true,
      message: 'Opening balances posted; ledger is now live',
      data: { entryId: r?.id ?? null },
    });
  } catch (err) {
    if (handleLedgerError(res, err)) return;
    if (err instanceof LedgerError) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    const name = (err as { name?: string })?.name;
    if (name === 'UnauthorizedError') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    console.error('commitCutover error:', err);
    res.status(500).json({ success: false, message: 'Failed to commit cutover' });
  }
}
