/**
 * tests/task7.statementsCash.test.ts
 *
 * P1 Task 7, bug 4b: the cash-flow forecast's opening cash must include per-bank
 * GL sub-accounts (children of the BANK/CASH control account that carry no role
 * mapping of their own). sumBankCashWithChildren is the shared roll-up that both
 * the balance sheet and the cash-flow forecast now use.
 */
import { describe, it, expect } from 'vitest';
import { sumBankCashWithChildren, type AccountBalance } from '../lib/ledger/statements';

function acct(p: Partial<AccountBalance> & { id: string }): AccountBalance {
  return {
    id: p.id,
    code: p.code ?? p.id,
    name: p.name ?? p.id,
    accountType: p.accountType ?? 'ASSET',
    debit: p.debit ?? '0',
    credit: p.credit ?? '0',
    role: p.role ?? null,
    parentId: p.parentId ?? null,
  };
}

describe('sumBankCashWithChildren (cash-flow opening cash)', () => {
  it('includes per-bank sub-accounts nested under the BANK control account', () => {
    const accounts: AccountBalance[] = [
      acct({ id: 'bank-root', role: 'BANK', debit: '100', credit: '0' }),
      // child bank sub-account with NO role mapping — the old query missed it
      acct({ id: 'hdfc', parentId: 'bank-root', debit: '500', credit: '0' }),
      acct({ id: 'icici', parentId: 'bank-root', debit: '250', credit: '20' }),
      acct({ id: 'cash', role: 'CASH', debit: '30', credit: '0' }),
      // an unrelated asset must NOT be counted
      acct({ id: 'receivables', role: 'AR', debit: '9999', credit: '0' }),
    ];

    // 100 + 500 + (250-20) + 30 = 860
    expect(sumBankCashWithChildren(accounts)).toBe(860);
  });

  it('degrades to just the role-mapped roots when no children exist', () => {
    const accounts: AccountBalance[] = [
      acct({ id: 'bank-root', role: 'BANK', debit: '100', credit: '0' }),
      acct({ id: 'cash', role: 'CASH', debit: '40', credit: '0' }),
    ];
    expect(sumBankCashWithChildren(accounts)).toBe(140);
  });
});
