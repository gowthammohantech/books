// lib/ledger/bankAccount.ts
//
// Single chokepoint for "which GL account does this specific bank post to?".
//
// A1 added BankDetail.accountId — a per-bank GL sub-account nested under the
// tenant's BANK control account. Bank postings should hit that sub-account so
// each bank reconciles independently, while the BANK parent rollup (and the
// trial balance) stay identical because children roll up to the parent.
//
// resolveBankGlAccountId(db, bankAccountId) returns:
//   - the BankDetail's accountId when set (post to the bank's own sub-account)
//   - null when the bank is un-backfilled (accountId IS NULL) → callers fall
//     back to the shared BANK role exactly as before (no regression).
//
// The returned id is threaded as a LineInstruction `accountId` OVERRIDE on the
// BANK leg only. It never changes the amount, the sign, or any other leg — the
// resolver simply names the sub-account instead of the role's control account.

/** Minimal structural slice of the Prisma client this helper needs. */
export interface BankAccountDb {
  bankDetail: {
    findUnique: (args: {
      where: { id: string };
      select?: { accountId: true };
    }) => Promise<{ accountId?: string | null } | null>;
  };
}

/**
 * Resolve the GL account a specific bank's postings should target.
 *
 * @returns the bank's own GL sub-account id, or null to fall back to the
 *          shared BANK role account (un-backfilled bank / no ledger mapping).
 */
export async function resolveBankGlAccountId(
  db: BankAccountDb,
  bankAccountId: string | null | undefined,
): Promise<string | null> {
  if (!bankAccountId) return null;
  const bank = await db.bankDetail.findUnique({
    where: { id: bankAccountId },
    select: { accountId: true },
  });
  return bank?.accountId ?? null;
}

// CommonJS interop for any legacy JS consumers.
module.exports = { resolveBankGlAccountId };
module.exports.resolveBankGlAccountId = resolveBankGlAccountId;
