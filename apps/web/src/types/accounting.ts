import type { AccountType } from '@elixirbooks/enums';

// Generated from apps/api/prisma/schema.prisma. Re-exported so the existing
// import sites for these names keep working.
export type { AccountType };

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parentId: string | null;
  parent?: { id: string; code: string; name: string } | null;
  description: string | null;
}

export interface JournalLine {
  id?: string;
  accountId: string;
  account?: { id: string; code: string; name: string };
  debit: number;
  credit: number;
  description?: string | null;
}

export interface JournalEntryRow {
  id: string;
  entryNumber: string | null;
  entryDate: string;
  description: string | null;
  reference: string | null;
  totalDebit: number;
  totalCredit: number;
  lineCount: number;
}
