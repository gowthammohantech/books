import { gatedPost, type PostingTx } from '../ledger/ledgerPosting';
import { reverse } from '../ledger/postingEngine';
import type { LineInstruction } from '../ledger/types';

const ZERO_RE = /^-?0*(\.0+)?$/; // matches "0", "0.00", "0.0000", "-0"
function isZero(v: string): boolean {
  return ZERO_RE.test(v) || Number(v) === 0;
}

export async function postPayRunLineAccrual(
  tx: PostingTx,
  p: {
    tenantId: string;
    lineId: string;
    date: Date;
    gross: string;
    net: string;
    deductions: string;
    wagesAccountId: string;
    netPayableAccountId: string;
    deductionsPayableAccountId: string;
  },
): Promise<void> {
  const lines: LineInstruction[] = [
    { accountId: p.wagesAccountId, side: 'debit', amount: p.gross },
    { accountId: p.netPayableAccountId, side: 'credit', amount: p.net },
  ];
  if (!isZero(p.deductions)) {
    lines.push({ accountId: p.deductionsPayableAccountId, side: 'credit', amount: p.deductions });
  }
  await gatedPost(tx, p.tenantId, p.date, 'PayRunLine', p.lineId, 'accrued', lines);
}

export async function reversePayRunLineAccrual(
  tx: PostingTx,
  p: { tenantId: string; lineId: string },
): Promise<void> {
  const je = await tx.journalEntry.findFirst({
    where: { tenantId: p.tenantId, sourceType: 'PayRunLine', sourceId: p.lineId, event: 'accrued', isDeleted: false },
    select: { id: true },
  } as never);
  if (!je) return;
  await reverse(tx, (je as { id: string }).id);
}
