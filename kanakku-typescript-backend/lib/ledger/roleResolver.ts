// lib/ledger/roleResolver.ts
import { LedgerError, type AccountResolver } from './buildLines';

export interface MappingRow {
  roleKey: string;
  accountId: string;
}

export function makeResolver(rows: MappingRow[]): AccountResolver {
  const map = new Map(rows.map((r) => [r.roleKey, r.accountId]));
  return (roleKey?: string, accountId?: string): string => {
    if (accountId) return accountId;
    if (!roleKey) throw new LedgerError('resolver called without role or account');
    const id = map.get(roleKey);
    if (!id) throw new LedgerError(`no account mapped for role ${roleKey}`);
    return id;
  };
}

/** Loads mapping rows for a tenant from a Prisma client/transaction. */
export async function loadResolver(
  tx: { ledgerAccountMapping: { findMany: (args: unknown) => Promise<MappingRow[]> } },
  userId: string,
): Promise<AccountResolver> {
  const rows = await tx.ledgerAccountMapping.findMany({
    where: { userId },
    select: { roleKey: true, accountId: true },
  });
  return makeResolver(rows);
}
