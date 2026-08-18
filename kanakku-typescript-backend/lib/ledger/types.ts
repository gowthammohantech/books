// lib/ledger/types.ts
import type { LedgerRole } from './roles';
import type { DecimalInput } from './money';

export type PostingSide = 'debit' | 'credit';

/** One leg of a posting. Targets EITHER a role (control account, resolved per
 *  tenant) OR an explicit accountId (P&L lines, e.g. expense category). */
export interface LineInstruction {
  roleKey?: LedgerRole;
  accountId?: string;
  side: PostingSide;
  amount: DecimalInput; // transaction-currency, >= 0
  /** Explicit functional-currency base amount for this leg. When set, overrides
   *  amount × rate. Required for FX settlement legs (e.g. relieving AR at the
   *  original document rate). A leg with amount=0 and baseAmount>0 is valid
   *  (FX adjustment leg). */
  baseAmount?: string;
  taxRoleKey?: string;
  description?: string;
}

export interface PostingInput {
  userId: string;
  sourceType: string;   // e.g. 'Invoice'
  sourceId: string;     // document id
  event: string;        // e.g. 'issued', 'payment'
  date: Date;
  currencyCode: string; // transaction currency
  exchangeRate?: DecimalInput; // to functional currency; default 1
  description?: string;
  isOpeningBalance?: boolean; // true only for the cutover opening entry
  /** P3.3 — optional dimension tagging; null/undefined → unchanged (zero-impact) */
  costCenterId?: string | null;
  projectId?: string | null;
  instructions: LineInstruction[];
}

/** A journal line ready to persist (journalEntryId attached by the engine). */
export interface BuiltLine {
  accountId: string;
  debit: string;
  credit: string;
  currencyCode: string;
  exchangeRate: string;
  baseDebit: string;
  baseCredit: string;
  taxRoleKey: string | null;
  description: string | null;
}
