/**
 * tests/accountCreditBalance.test.ts
 *
 * Unit coverage for lib/contacts/accountCreditBalance.ts — the single source
 * of truth both the grant/void endpoints (this slice) AND the parallel
 * invoice-payment redemption task rely on for a contact's live Account
 * Credit balance:
 *
 *   balance = SUM(amount WHERE type='GRANT' AND isVoided=false)
 *           - SUM(amount WHERE type='REDEMPTION' AND isVoided=false)
 *
 * The balance is NEVER stored — always derived from AccountCreditEntry rows,
 * scoped to (userId, contactId). These tests mock the aggregate() calls
 * directly (no real DB) and assert the arithmetic + voided-row exclusion via
 * the `where` clauses passed to aggregate().
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { getAccountCreditBalance, type AccountCreditBalanceDb } from '../lib/contacts/accountCreditBalance';

const TENANT_ID = 'tenant-1';
const CONTACT_ID = 'contact-1';

function makeDb(grantSum: number | null, redemptionSum: number | null) {
  const aggregate = vi.fn(async (args: { where: { type: string } }) => {
    if (args.where.type === 'GRANT') {
      return { _sum: { amount: grantSum == null ? null : new Prisma.Decimal(grantSum) } };
    }
    return { _sum: { amount: redemptionSum == null ? null : new Prisma.Decimal(redemptionSum) } };
  });
  return { db: { accountCreditEntry: { aggregate } } as AccountCreditBalanceDb, aggregate };
}

describe('getAccountCreditBalance', () => {
  it('sums grants when there are no redemptions', async () => {
    const { db } = makeDb(500, null);
    const balance = await getAccountCreditBalance(db, { userId: TENANT_ID, contactId: CONTACT_ID });
    expect(balance.toString()).toBe('500');
  });

  it('subtracts redemptions from grants', async () => {
    const { db } = makeDb(500, 200);
    const balance = await getAccountCreditBalance(db, { userId: TENANT_ID, contactId: CONTACT_ID });
    expect(balance.toString()).toBe('300');
  });

  it('returns zero when there are no grants or redemptions at all', async () => {
    const { db } = makeDb(null, null);
    const balance = await getAccountCreditBalance(db, { userId: TENANT_ID, contactId: CONTACT_ID });
    expect(balance.toString()).toBe('0');
  });

  it('fully redeemed credit nets to zero', async () => {
    const { db } = makeDb(500, 500);
    const balance = await getAccountCreditBalance(db, { userId: TENANT_ID, contactId: CONTACT_ID });
    expect(balance.toString()).toBe('0');
  });

  it('scopes both aggregate queries by userId, contactId, and isVoided:false (voided rows excluded)', async () => {
    const { db, aggregate } = makeDb(500, 100);
    await getAccountCreditBalance(db, { userId: TENANT_ID, contactId: CONTACT_ID });

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TENANT_ID, contactId: CONTACT_ID, type: 'GRANT', isVoided: false },
      }),
    );
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TENANT_ID, contactId: CONTACT_ID, type: 'REDEMPTION', isVoided: false },
      }),
    );
  });
});
