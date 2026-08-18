// lib/ledger/postMoneyIn.ts
import { post } from './postingEngine';
import { shouldPost } from './postingGate';
import { cashRoleFor, type PostingTx } from './ledgerPosting';
import { toDecimal } from './money';
import type { LineInstruction } from './types';
import type { DecimalInput } from './money';

const sub = (total: string, tax: string): string => toDecimal(total).minus(toDecimal(tax)).toString();
const isPos = (v: string): boolean => toDecimal(v).greaterThan(0);

export async function postMoneyIn(
  tx: PostingTx,
  p: {
    userId: string;
    sourceType: string;
    sourceId: string;
    event: string;
    date: Date;
    total: string;
    tax: string;
    incomeAccountId: string;
    /** Used to select BANK vs CASH role (mirrors postExpense behaviour). */
    sourceTypeCash?: string | null;
    paymentModeSlug?: string | null;
    /** Per-bank GL sub-account (BankDetail.accountId) for the BANK leg; null → shared BANK role. */
    bankGlAccountId?: string | null;
    currencyCode?: string;
    exchangeRate?: DecimalInput;
    costCenterId?: string | null;
    projectId?: string | null;
  },
): Promise<void> {
  const settings = await tx.companySettings.findFirst({ where: { userId: p.userId } });
  if (!shouldPost(settings, p.date)) return;

  const net = sub(p.total, p.tax);
  const into = cashRoleFor({ sourceType: p.sourceTypeCash, paymentModeSlug: p.paymentModeSlug });

  // BANK leg targets the per-bank GL sub-account when known; CASH (or an
  // un-backfilled bank with bankGlAccountId null) falls back to the role key.
  const intoLeg: LineInstruction =
    into === 'BANK' && p.bankGlAccountId
      ? { accountId: p.bankGlAccountId, side: 'debit', amount: p.total }
      : { roleKey: into, side: 'debit', amount: p.total };

  const lines: LineInstruction[] = [
    intoLeg,
    { accountId: p.incomeAccountId, side: 'credit', amount: net },
  ];
  if (isPos(p.tax)) {
    lines.push({ roleKey: 'OUTPUT_TAX', side: 'credit', amount: p.tax, taxRoleKey: 'OUTPUT_TAX' });
  }

  const effectiveCurrency = p.currencyCode && p.currencyCode !== 'BASE' ? p.currencyCode : 'BASE';
  const effectiveRate = effectiveCurrency !== 'BASE' ? p.exchangeRate : undefined;

  await post(tx, {
    userId: p.userId,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
    event: p.event,
    date: p.date,
    currencyCode: effectiveCurrency,
    exchangeRate: effectiveRate,
    costCenterId: p.costCenterId ?? null,
    projectId: p.projectId ?? null,
    instructions: lines,
  });
}

// CommonJS interop for any .js consumers (Task 6 uses ESM TS import; this is a safety net)
module.exports = { postMoneyIn };
module.exports.postMoneyIn = postMoneyIn;
