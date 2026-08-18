import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { validationResult } from 'express-validator';
import type { ValidationChain } from 'express-validator';
import type { RequestHandler } from 'express';

// Name-uniqueness .custom() check calls prisma.taxRate.findFirst — mock it to "no clash".
vi.mock('../lib/prisma', () => ({
  prisma: {
    taxRate: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

// Loaded in beforeAll (not top-level await) so tsc doesn't need target/module
// bumped just for this test file.
let createTaxRateValidator: (ValidationChain | RequestHandler)[];

beforeAll(async () => {
  ({ createTaxRateValidator } = await import('../validators/taxRateValidator'));
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function runValidator(body: Record<string, unknown>) {
  const req = { body, user: 'tenant-1' } as never;
  for (const chain of createTaxRateValidator) {
    // handleValidationErrors is a plain RequestHandler with no .run — skip it.
    if (typeof (chain as { run?: unknown }).run === 'function') {
      // eslint-disable-next-line no-await-in-loop
      await (chain as { run: (r: never) => Promise<unknown> }).run(req);
    }
  }
  return validationResult(req as never);
}

describe('createTaxRateValidator — unified tax: kind-less GST_INDIA rates', () => {
  it('passes GST_INDIA with no taxKind (the unified "GST 18%" shape)', async () => {
    const errors = await runValidator({ name: 'GST 18%', rate: 18, regime: 'GST_INDIA' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('passes GST_INDIA with a valid taxKind supplied', async () => {
    const errors = await runValidator({ name: 'CGST 9%', rate: 9, regime: 'GST_INDIA', taxKind: 'CGST' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('still rejects an invalid taxKind value for GST_INDIA', async () => {
    const errors = await runValidator({ name: 'Bad Kind', rate: 9, regime: 'GST_INDIA', taxKind: 'NOT_A_KIND' });
    expect(errors.isEmpty()).toBe(false);
  });

  it('still requires taxKind for US_SALES_TAX (unchanged behavior)', async () => {
    const errors = await runValidator({ name: 'Sales Tax', rate: 7, regime: 'US_SALES_TAX' });
    expect(errors.isEmpty()).toBe(false);
  });

  it('passes US_SALES_TAX when a valid taxKind is supplied', async () => {
    const errors = await runValidator({ name: 'Sales Tax', rate: 7, regime: 'US_SALES_TAX', taxKind: 'SALES_TAX' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('still fails when required fields (name/rate/regime) are missing', async () => {
    const errors = await runValidator({ regime: 'GST_INDIA' });
    expect(errors.isEmpty()).toBe(false);
  });
});
