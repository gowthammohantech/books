import type { AccountType } from '@prisma/client';

export interface SeedAccount {
  code: string;
  name: string;
  accountType: AccountType;
  parentCode?: string;
}

export const DEFAULT_ACCOUNTS: SeedAccount[] = [
  // ASSETS
  { code: '1000', name: 'Assets', accountType: 'ASSET' },
  { code: '1001', name: 'Cash on Hand', accountType: 'ASSET', parentCode: '1000' },
  { code: '1002', name: 'Bank Accounts', accountType: 'ASSET', parentCode: '1000' },
  { code: '1100', name: 'Accounts Receivable', accountType: 'ASSET', parentCode: '1000' },
  { code: '1200', name: 'Inventory', accountType: 'ASSET', parentCode: '1000' },
  { code: '1500', name: 'Fixed Assets', accountType: 'ASSET', parentCode: '1000' },
  // LIABILITIES
  { code: '2000', name: 'Liabilities', accountType: 'LIABILITY' },
  { code: '2001', name: 'Accounts Payable', accountType: 'LIABILITY', parentCode: '2000' },
  { code: '2100', name: 'GST Payable', accountType: 'LIABILITY', parentCode: '2000' },
  { code: '2200', name: 'Loans Payable', accountType: 'LIABILITY', parentCode: '2000' },
  // EQUITY
  { code: '3000', name: 'Equity', accountType: 'EQUITY' },
  { code: '3001', name: 'Owner Equity', accountType: 'EQUITY', parentCode: '3000' },
  { code: '3100', name: 'Retained Earnings', accountType: 'EQUITY', parentCode: '3000' },
  // INCOME
  { code: '4000', name: 'Income', accountType: 'INCOME' },
  { code: '4001', name: 'Sales Revenue', accountType: 'INCOME', parentCode: '4000' },
  { code: '4002', name: 'Service Revenue', accountType: 'INCOME', parentCode: '4000' },
  { code: '4100', name: 'Other Income', accountType: 'INCOME', parentCode: '4000' },
  // EXPENSES
  { code: '5000', name: 'Expenses', accountType: 'EXPENSE' },
  { code: '5001', name: 'Cost of Goods Sold', accountType: 'EXPENSE', parentCode: '5000' },
  { code: '5100', name: 'Operating Expenses', accountType: 'EXPENSE', parentCode: '5000' },
  { code: '5101', name: 'Rent', accountType: 'EXPENSE', parentCode: '5100' },
  { code: '5102', name: 'Utilities', accountType: 'EXPENSE', parentCode: '5100' },
  { code: '5103', name: 'Salaries & Wages', accountType: 'EXPENSE', parentCode: '5100' },
  { code: '5200', name: 'Other Expenses', accountType: 'EXPENSE', parentCode: '5000' },
];

export async function seedDefaultChart(prisma: import('@prisma/client').PrismaClient, userId: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const codeToId = new Map<string, string>();

  // First pass: create top-level (no parent)
  for (const acc of DEFAULT_ACCOUNTS.filter((a) => !a.parentCode)) {
    const existing = await prisma.account.findUnique({ where: { userId_code: { userId, code: acc.code } } });
    if (existing) {
      codeToId.set(acc.code, existing.id);
      skipped++;
      continue;
    }
    const row = await prisma.account.create({
      data: { userId, code: acc.code, name: acc.name, accountType: acc.accountType },
    });
    codeToId.set(acc.code, row.id);
    created++;
  }

  // Second pass: children
  for (const acc of DEFAULT_ACCOUNTS.filter((a) => !!a.parentCode)) {
    const existing = await prisma.account.findUnique({ where: { userId_code: { userId, code: acc.code } } });
    if (existing) {
      codeToId.set(acc.code, existing.id);
      skipped++;
      continue;
    }
    const parentId = codeToId.get(acc.parentCode!);
    const row = await prisma.account.create({
      data: { userId, code: acc.code, name: acc.name, accountType: acc.accountType, parentId: parentId ?? null },
    });
    codeToId.set(acc.code, row.id);
    created++;
  }

  return { created, skipped };
}
