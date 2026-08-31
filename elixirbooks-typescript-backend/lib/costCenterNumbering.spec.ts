// lib/costCenterNumbering.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { nextCentreDocumentNumber, peekCentreDocumentNumber } from './costCenterNumbering';

function fakeTx(centre: { numberPrefix: string | null; nextNumber: number } | null) {
  let current = centre ? centre.nextNumber : 0;
  return {
    current: () => current,
    costCenter: {
      findFirst: vi.fn().mockResolvedValue(centre),
      update: vi.fn().mockImplementation(async () => {
        current += 1;
        return { nextNumber: current, numberPrefix: centre?.numberPrefix ?? null };
      }),
    },
  };
}

/** Probe that reports the given numbers as already taken install-wide. */
function fakeModel(taken: string[] = []) {
  return {
    findFirst: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const wanted = Object.values(args.where)[0];
      return taken.includes(String(wanted)) ? { id: 'other-tenant-row' } : null;
    }),
  };
}

const base = { tenantId: 'u1', field: 'invoiceNumber' };

describe('nextCentreDocumentNumber', () => {
  it('formats prefix + zero-padded counter', async () => {
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 1 });
    const n = await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-sales', model: fakeModel(),
    });
    expect(n).toBe('SAL-000001');
  });

  it('advances the centre counter by exactly one', async () => {
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 7 });
    const n = await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-sales', model: fakeModel(),
    });
    expect(n).toBe('SAL-000007');
    expect(tx.current()).toBe(8);
    expect(tx.costCenter.update).toHaveBeenCalledOnce();
  });

  it('keeps two centres on independent sequences', async () => {
    const sales = fakeTx({ numberPrefix: 'SAL-', nextNumber: 1 });
    const academy = fakeTx({ numberPrefix: 'ACAD-', nextNumber: 1 });
    const model = fakeModel();

    expect(await nextCentreDocumentNumber(sales as never, { ...base, costCenterId: 'cc-s', model })).toBe('SAL-000001');
    expect(await nextCentreDocumentNumber(sales as never, { ...base, costCenterId: 'cc-s', model })).toBe('SAL-000002');
    // Academy is untouched by Sales' two invoices.
    expect(await nextCentreDocumentNumber(academy as never, { ...base, costCenterId: 'cc-a', model })).toBe('ACAD-000001');
  });

  it('returns null when no centre is supplied, so the caller uses the global sequence', async () => {
    const tx = fakeTx(null);
    expect(await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: null, model: fakeModel(),
    })).toBeNull();
    expect(tx.costCenter.findFirst).not.toHaveBeenCalled();
  });

  it('returns null and does NOT advance when the centre has no prefix', async () => {
    // A prefix-less centre opts out of its own series; burning a number would
    // leave an unexplained gap.
    const tx = fakeTx({ numberPrefix: null, nextNumber: 5 });
    expect(await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-x', model: fakeModel(),
    })).toBeNull();
    expect(tx.costCenter.update).not.toHaveBeenCalled();
    expect(tx.current()).toBe(5);
  });

  it('returns null when the centre is missing or deleted', async () => {
    const tx = fakeTx(null);
    expect(await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-gone', model: fakeModel(),
    })).toBeNull();
    expect(tx.costCenter.update).not.toHaveBeenCalled();
  });

  it('bumps past a number another tenant already holds install-wide', async () => {
    // Document number columns are globally unique, so two tenants sharing the
    // prefix SAL- can collide even though their counters are independent.
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 1 });
    const n = await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-s', model: fakeModel(['SAL-000001', 'SAL-000002']),
    });
    expect(n).toBe('SAL-000003');
    expect(tx.current()).toBe(4);
  });

  it('throws a P2002-shaped error when every attempt collides', async () => {
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 1 });
    const allTaken = { findFirst: vi.fn().mockResolvedValue({ id: 'taken' }) };
    await expect(nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-s', model: allTaken as never, maxAttempts: 3,
    })).rejects.toMatchObject({ code: 'P2002' });
    expect(tx.costCenter.update).toHaveBeenCalledTimes(3);
  });

  it('honours a custom pad width', async () => {
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 42 });
    const n = await nextCentreDocumentNumber(tx as never, {
      ...base, costCenterId: 'cc-s', model: fakeModel(), width: 4,
    });
    expect(n).toBe('SAL-0042');
  });
});

describe('peekCentreDocumentNumber', () => {
  it('previews the next number without reserving it', async () => {
    // The create form previews a number on every open; reserving here would
    // leave a gap for every abandoned form.
    const tx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 9 });
    expect(await peekCentreDocumentNumber(tx as never, { tenantId: 'u1', costCenterId: 'cc-s' })).toBe('SAL-000009');
    expect(tx.costCenter.update).not.toHaveBeenCalled();
    expect(tx.current()).toBe(9);
  });

  it('returns null for no centre or a prefix-less centre', async () => {
    expect(await peekCentreDocumentNumber(fakeTx(null) as never, { tenantId: 'u1', costCenterId: null })).toBeNull();
    expect(await peekCentreDocumentNumber(
      fakeTx({ numberPrefix: null, nextNumber: 3 }) as never,
      { tenantId: 'u1', costCenterId: 'cc-x' },
    )).toBeNull();
  });

  it('agrees with what nextCentreDocumentNumber will actually issue', async () => {
    // If the preview and the issued number disagree, users report it as a bug.
    const peekTx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 12 });
    const issueTx = fakeTx({ numberPrefix: 'SAL-', nextNumber: 12 });
    const preview = await peekCentreDocumentNumber(peekTx as never, { tenantId: 'u1', costCenterId: 'cc-s' });
    const issued = await nextCentreDocumentNumber(issueTx as never, {
      ...base, costCenterId: 'cc-s', model: fakeModel(),
    });
    expect(preview).toBe(issued);
  });
});
