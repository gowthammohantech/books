import { describe, it, expect, vi } from 'vitest';
import { planGroupResolution, migrateTaxesToRates, type GroupShape, type MigrateDb } from './migrateTaxesToRates';

const member = (id: string, userId: string, name: string, rate: number, regime = 'GST_INDIA', extras: Record<string, unknown> = {}) =>
  ({ id, userId, name, rate, regime, isActive: true, isDeleted: false, ...extras });

describe('planGroupResolution', () => {
  it('1-member group → that member', () => {
    const g: GroupShape = { id: 'g', tax_name: 'VAT', tax_rates: [member('r1', 'u1', 'VAT 20%', 20, 'VAT_UK')] };
    expect(planGroupResolution(g)).toEqual({ kind: 'single', taxRateId: 'r1' });
  });

  it('N-member group → summed per-tenant rate (name = group name, regime from members)', () => {
    const g: GroupShape = {
      id: 'g', tax_name: 'GST 18%',
      tax_rates: [member('c', 'u1', 'CGST 9%', 9), member('s', 'u1', 'SGST 9%', 9)],
    };
    expect(planGroupResolution(g)).toEqual({ kind: 'summed', userId: 'u1', name: 'GST 18%', regime: 'GST_INDIA', rate: 18 });
  });

  it('"No Tax" group resolves to a NONE member, never a sum of pack rates', () => {
    const g: GroupShape = {
      id: 'g', tax_name: 'No Tax',
      tax_rates: [member('vat', 'u1', 'VAT Standard 20%', 20, 'VAT_UK'), member('none', 'u1', 'No Tax 0%', 0, 'NONE')],
    };
    expect(planGroupResolution(g)).toEqual({ kind: 'single', taxRateId: 'none' });
  });

  it('"No Tax" group with no NONE member → find-or-create for the first member tenant', () => {
    const g: GroupShape = {
      id: 'g', tax_name: 'No Tax',
      tax_rates: [member('vat', 'u1', 'VAT Standard 20%', 20, 'VAT_UK')],
    };
    expect(planGroupResolution(g)).toEqual({ kind: 'noTax', userId: 'u1' });
  });

  it('empty / fully-deleted group → skip', () => {
    const g: GroupShape = { id: 'g', tax_name: 'Dead', tax_rates: [member('x', 'u1', 'X', 5, 'VAT_UK', { isDeleted: true })] };
    expect(planGroupResolution(g)).toEqual({ kind: 'skip' });
  });
});

function fakeDb(
  products: Array<{ id: string; taxGroupId: string | null; taxRateId: string | null }>,
  groups: GroupShape[],
) {
  let seq = 0;
  const createdRates: Array<Record<string, unknown>> = [];
  const db: MigrateDb = {
    product: {
      findMany: vi.fn(async () =>
        products.filter((p) => p.taxGroupId && !p.taxRateId).map((p) => ({ id: p.id, taxGroupId: p.taxGroupId }))),
      update: vi.fn(async (args: unknown) => {
        const a = args as { where: { id: string }; data: { taxRateId: string } };
        const p = products.find((x) => x.id === a.where.id)!;
        p.taxRateId = a.data.taxRateId;
        return p;
      }),
    },
    taxGroup: { findMany: vi.fn(async () => groups) },
    taxRate: {
      findFirst: vi.fn(async (args: unknown) => {
        const w = (args as { where: Record<string, unknown> }).where;
        const hit = createdRates.find(
          (r) => r.userId === w.userId
            && (w.name === undefined || r.name === w.name)
            && (w.rate === undefined || Number(r.rate) === Number(w.rate))
            && (w.regime === undefined || r.regime === w.regime),
        );
        return hit ? { id: hit.id as string } : null;
      }),
      create: vi.fn(async (args: { data: unknown }) => {
        const row = { id: `new-${++seq}`, ...(args.data as Record<string, unknown>) };
        createdRates.push(row);
        return { id: row.id as string };
      }),
    },
  };
  return { db, createdRates, products };
}

describe('migrateTaxesToRates — runner', () => {
  it('collapses an N-member group to ONE summed rate shared by all its products; re-runs are no-ops', async () => {
    const groups: GroupShape[] = [{
      id: 'g18', tax_name: 'GST 18%',
      tax_rates: [member('c', 'u1', 'CGST 9%', 9), member('s', 'u1', 'SGST 9%', 9)],
    }];
    const { db, createdRates, products } = fakeDb(
      [
        { id: 'p1', taxGroupId: 'g18', taxRateId: null },
        { id: 'p2', taxGroupId: 'g18', taxRateId: null },
      ],
      groups,
    );

    const first = await migrateTaxesToRates(db);
    expect(first).toEqual({ updated: 2, createdRates: 1 });
    expect(createdRates).toHaveLength(1);
    expect(createdRates[0]).toMatchObject({ userId: 'u1', name: 'GST 18%', regime: 'GST_INDIA', rate: '18' });
    expect(products[0].taxRateId).toBe(createdRates[0].id);
    expect(products[1].taxRateId).toBe(createdRates[0].id);

    const second = await migrateTaxesToRates(db);
    expect(second).toEqual({ updated: 0, createdRates: 0 });
    expect(createdRates).toHaveLength(1);
  });

  it('1-member group links directly without creating a rate', async () => {
    const groups: GroupShape[] = [{ id: 'g20', tax_name: 'VAT', tax_rates: [member('r20', 'u1', 'VAT 20%', 20, 'VAT_UK')] }];
    const { db, createdRates, products } = fakeDb([{ id: 'p1', taxGroupId: 'g20', taxRateId: null }], groups);
    const out = await migrateTaxesToRates(db);
    expect(out).toEqual({ updated: 1, createdRates: 0 });
    expect(createdRates).toHaveLength(0);
    expect(products[0].taxRateId).toBe('r20');
  });
});
