import { describe, it, expect, vi } from 'vitest';
import { ensureGstComponentRates } from './ensureGstComponentRates';
import { splitGstRate } from '../taxEngine';

function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  let seq = 0;
  return {
    rows,
    taxRate: {
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        const hit = rows.find(
          (r) => r.userId === w.userId && r.taxKind === w.taxKind
            && Number(r.rate) === Number(w.rate) && r.isDeleted !== true,
        );
        return hit ? { id: hit.id as string } : null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { id: `tr-${++seq}`, ...args.data };
        rows.push(row);
        return { id: row.id as string };
      }),
    },
  };
}

describe('ensureGstComponentRates — lazy per-tenant provisioning', () => {
  it('creates missing component rows flagged isSystemComponent', async () => {
    const db = fakeDb();
    const out = await ensureGstComponentRates(db as never, 'u1', splitGstRate({ totalPercent: 18, intraState: true }));
    expect(out.map((c) => c.kind)).toEqual(['CGST', 'SGST']);
    expect(db.rows).toHaveLength(2);
    expect(db.rows.every((r) => r.isSystemComponent === true && r.regime === 'GST_INDIA')).toBe(true);
    expect(out.every((c) => typeof c.taxRateId === 'string' && c.taxRateId.length > 0)).toBe(true);
  });

  it('is idempotent — repeat resolve reuses rows, never duplicates', async () => {
    const db = fakeDb();
    const first = await ensureGstComponentRates(db as never, 'u1', splitGstRate({ totalPercent: 18, intraState: true }));
    const second = await ensureGstComponentRates(db as never, 'u1', splitGstRate({ totalPercent: 18, intraState: true }));
    expect(db.rows).toHaveLength(2);
    expect(second.map((c) => c.taxRateId)).toEqual(first.map((c) => c.taxRateId));
  });

  it('reuses an existing user-facing row with matching kind+rate (demo CGST 9%)', async () => {
    const db = fakeDb();
    db.rows.push({ id: 'legacy-cgst9', userId: 'u1', taxKind: 'CGST', rate: 9, isDeleted: false, isSystemComponent: false });
    const out = await ensureGstComponentRates(db as never, 'u1', splitGstRate({ totalPercent: 18, intraState: true }));
    expect(out.find((c) => c.kind === 'CGST')?.taxRateId).toBe('legacy-cgst9');
    expect(db.rows).toHaveLength(2); // only SGST created
  });
});
