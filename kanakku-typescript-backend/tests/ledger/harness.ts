// tests/ledger/harness.ts
// In-memory ledger harness for golden-number integration tests.
// Builds a fake PostingTx from a CountryPack, records real journal entries
// in memory, and exposes balances() joined to pack account metadata.

import type { PostingTx } from '../../lib/ledger/ledgerPosting';
import type { AccountBalance } from '../../lib/ledger/statements';
import type { CountryPack } from '../../lib/ledger/packs/types';

// ---------------------------------------------------------------------------
// Internal in-memory storage
// ---------------------------------------------------------------------------

interface StoredLine {
  accountId: string;
  debit: string;
  credit: string;
  baseDebit: string;
  baseCredit: string;
  currencyCode: string | null;
  exchangeRate: string;
  taxRoleKey: string | null;
  description: string | null;
}

interface StoredEntry {
  id: string;
  userId: string;
  entryDate: Date;
  sourceType: string | null;
  sourceId: string | null;
  event: string | null;
  isDeleted: boolean;
  reversedById: string | null;
  reversals: { id: string }[];
  lines: StoredLine[];
}

// ---------------------------------------------------------------------------
// Harness factory
// ---------------------------------------------------------------------------

export function buildHarness(pack: CountryPack, userId = 'u-golden') {
  const entries: StoredEntry[] = [];
  let seq = 0;

  function nextId(): string {
    seq += 1;
    return `je-${seq}`;
  }

  // Build role → accountId map from pack.roleMap (role → code) and use the
  // code as the accountId (codes are unique within a pack).
  const roleToId: Record<string, string> = {};
  for (const [role, code] of Object.entries(pack.roleMap)) {
    roleToId[role] = code;
  }

  // Build code → PackAccount lookup for balances()
  const codeToAccount = new Map(pack.accounts.map((a) => [a.code, a]));

  // -------------------------------------------------------------------------
  // journalEntry mock
  // -------------------------------------------------------------------------

  const journalEntry = {
    async findFirst(args: unknown): Promise<StoredEntry | null> {
      const w = (args as { where?: Record<string, unknown> }).where ?? {};
      return (
        entries.find((e) => {
          if ('id' in w && e.id !== w['id']) return false;
          if ('userId' in w && e.userId !== w['userId']) return false;
          if ('sourceType' in w && e.sourceType !== w['sourceType']) return false;
          if ('sourceId' in w && e.sourceId !== w['sourceId']) return false;
          if ('event' in w && e.event !== w['event']) return false;
          if ('isDeleted' in w && e.isDeleted !== w['isDeleted']) return false;
          return true;
        }) ?? null
      );
    },

    async create(args: { data: unknown }): Promise<{ id: string }> {
      const d = args.data as {
        userId: string;
        entryDate: Date;
        sourceType?: string | null;
        sourceId?: string | null;
        event?: string | null;
        reversedById?: string | null;
        lines?: { create: StoredLine[] };
      };
      const id = nextId();
      const entry: StoredEntry = {
        id,
        userId: d.userId,
        entryDate: d.entryDate,
        sourceType: d.sourceType ?? null,
        sourceId: d.sourceId ?? null,
        event: d.event ?? null,
        isDeleted: false,
        reversedById: d.reversedById ?? null,
        reversals: [],
        lines: d.lines?.create ?? [],
      };

      // If this is a reversal, add a back-reference to the original
      if (d.reversedById) {
        const original = entries.find((e) => e.id === d.reversedById);
        if (original) {
          original.reversals.push({ id });
        }
      }

      entries.push(entry);
      return { id };
    },
  };

  // -------------------------------------------------------------------------
  // ledgerAccountMapping mock — returns (role → accountId) pairs from pack
  // -------------------------------------------------------------------------

  const ledgerAccountMapping = {
    async findMany(_args: unknown): Promise<{ roleKey: string; accountId: string }[]> {
      return Object.entries(roleToId).map(([roleKey, accountId]) => ({ roleKey, accountId }));
    },
  };

  // -------------------------------------------------------------------------
  // accountingPeriod mock — never locked
  // -------------------------------------------------------------------------

  const accountingPeriod = {
    async findFirst(_args: unknown): Promise<null> {
      return null;
    },
  };

  // -------------------------------------------------------------------------
  // companySettings mock — initialized with a far-past go-live date
  // -------------------------------------------------------------------------

  const companySettings = {
    async findFirst(_args: unknown): Promise<{ ledgerInitialized: boolean; goLiveDate: Date | null }> {
      return {
        ledgerInitialized: true,
        goLiveDate: new Date('2000-01-01'), // far past — all dates pass the gate
      };
    },
  };

  // -------------------------------------------------------------------------
  // PostingTx assembly
  // -------------------------------------------------------------------------

  const tx: PostingTx = {
    journalEntry,
    ledgerAccountMapping,
    accountingPeriod,
    companySettings,
  } as unknown as PostingTx;

  // -------------------------------------------------------------------------
  // balances() — aggregate all stored lines into AccountBalance[]
  // -------------------------------------------------------------------------

  function balances(): AccountBalance[] {
    // Accumulate debit/credit totals per accountId (= code in this harness)
    const totals = new Map<string, { debit: number; credit: number }>();

    for (const entry of entries) {
      if (entry.isDeleted) continue;
      for (const line of entry.lines) {
        const existing = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
        existing.debit += Number(line.baseDebit);
        existing.credit += Number(line.baseCredit);
        totals.set(line.accountId, existing);
      }
    }

    const result: AccountBalance[] = [];

    for (const [code, acc] of codeToAccount.entries()) {
      const t = totals.get(code);
      if (!t) continue; // skip accounts that were never touched

      result.push({
        id: code,
        code: acc.code,
        name: acc.name,
        accountType: acc.accountType as AccountBalance['accountType'],
        role: acc.role ?? null,
        debit: t.debit.toFixed(4),
        credit: t.credit.toFixed(4),
      });
    }

    return result;
  }

  return { tx, balances };
}
