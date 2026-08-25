import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validationResult } from 'express-validator';

// Uniqueness .custom() checks call prisma.product.findFirst — mock it to "no clash".
vi.mock('../lib/prisma', () => ({
  prisma: {
    product: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

const [{ createProductValidator }, { prisma }] = await Promise.all([
  import('../validators/productValidator'),
  import('../lib/prisma'),
]);

beforeEach(() => {
  vi.clearAllMocks();
});

async function runValidator(body: Record<string, unknown>) {
  const req = { body } as never;
  for (const chain of createProductValidator) {
    // commonErrorHandler is a plain RequestHandler with no .run — skip it.
    if (typeof (chain as { run?: unknown }).run === 'function') {
      // eslint-disable-next-line no-await-in-loop
      await (chain as { run: (r: never) => Promise<unknown> }).run(req);
    }
  }
  return validationResult(req as never);
}

describe('createProductValidator — items unification (name is the ONLY required field)', () => {
  it('passes with name alone', async () => {
    const errors = await runValidator({ name: 'Consulting' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('passes with no item_type and no unit (both optional/derived now)', async () => {
    const errors = await runValidator({ name: 'Web development', selling_price: '250' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('accepts the new taxRateId payload field', async () => {
    const errors = await runValidator({ name: 'Hosting', taxRateId: 'rate-1' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('keeps accepting the legacy tax (group id) field', async () => {
    const errors = await runValidator({ name: 'Hosting', tax: 'group-1' });
    expect(errors.isEmpty()).toBe(true);
  });

  it('still validates item_type values when one IS sent', async () => {
    const errors = await runValidator({ name: 'Widget', item_type: 'Gadget' });
    expect(errors.isEmpty()).toBe(false);
  });

  it('treats blank optional fields (empty strings) as absent', async () => {
    const errors = await runValidator({
      name: 'Box of nails',
      item_type: '', unit: '', category: '', brand: '', tax: '', taxRateId: '',
      code: '', barcode: '', selling_price: '', purchase_price: '',
    });
    expect(errors.isEmpty()).toBe(true);
    // Blank code/barcode short-circuit before the uniqueness DB check runs.
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
  });

  it('still fails when name is missing', async () => {
    const errors = await runValidator({ item_type: 'Product', unit: 'u-hr' });
    expect(errors.isEmpty()).toBe(false);
  });

  it('still rejects a negative selling_price when one is supplied', async () => {
    const errors = await runValidator({ name: 'Bad price', selling_price: '-5' });
    expect(errors.isEmpty()).toBe(false);
  });
});
