import { describe, it, expect, vi } from 'vitest';

import { ProductService, deriveItemType, parseBoolFlag } from './product.service';
import type { ProductRepository } from './product.repository';

vi.mock('../../lib/customFieldValues', () => ({
  insertCustomFieldValues: vi.fn(async () => undefined),
}));

/**
 * A stub repository.
 *
 * This is the point of the layer, and the thing Stage 3 exists to prove: the
 * 97 suites that reach ProductController today have to `vi.mock('../lib/prisma')`
 * and rebuild a per-model delegate map to say anything at all. The service takes
 * its repository through the constructor, so a test asserts on plain objects.
 */
function stubRepo(over: Partial<ProductRepository> = {}) {
  const created: Record<string, unknown>[] = [];
  const inventory: Record<string, unknown>[] = [];
  const repo = {
    findDefaultNoneTaxRate: vi.fn(async () => ({ id: 'none-rate' })),
    generateUniqueCode: vi.fn(async () => 'PROD-GENERATED'),
    createProduct: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      created.push(data);
      return { id: 'p1', ...data } as never;
    }),
    updateProduct: vi.fn(async (_tx: unknown, id: string, data: Record<string, unknown>) => {
      return { id, enable_inventory: false, stock: 0, unitId: null, ...data } as never;
    }),
    createInventory: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      inventory.push(data);
    }),
    findInventoryInTx: vi.fn(async () => null),
    // Callback form, matching the repository's own signature.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    ...over,
  } as unknown as ProductRepository;
  return { repo, created, inventory };
}

const baseInput = {
  tenantId: 't1',
  actingUserId: 'u1',
  hasActor: true,
  rawCustomFields: undefined,
  files: [],
  productImage: null,
  galleryImages: [],
  currencyCode: null,
};

describe('deriveItemType', () => {
  it('derives from inventory tracking when item_type is omitted', () => {
    expect(deriveItemType(undefined, true)).toBe('Product');
    expect(deriveItemType(undefined, false)).toBe('Service');
  });

  it('lets an explicit type win over the derivation', () => {
    expect(deriveItemType('Product', false)).toBe('Product');
    expect(deriveItemType('Service', true)).toBe('Service');
  });

  it('falls back to the derivation for an unrecognised value', () => {
    expect(deriveItemType('Widget', true)).toBe('Product');
  });
});

describe('parseBoolFlag', () => {
  it('accepts the multipart and JSON truthy spellings', () => {
    for (const v of ['true', '1', true, 1]) expect(parseBoolFlag(v)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const v of ['false', '0', false, 0, undefined, null, '']) expect(parseBoolFlag(v)).toBe(false);
  });
});

describe('ProductService.create', () => {
  it('forces a Service to be untracked, zero-stock and zero-alert', async () => {
    const { repo, created } = stubRepo();
    await new ProductService(repo).create({
      ...baseInput,
      body: { name: 'Consulting', item_type: 'Service', enable_inventory: 'true', stock: '9', alert_quantity: '4' },
    });
    expect(created[0]).toMatchObject({
      item_type: 'Service',
      enable_inventory: false,
      stock: 0,
      alert_quantity: 0,
    });
  });

  it('generates a code only when one was not supplied', async () => {
    const { repo, created } = stubRepo();
    const svc = new ProductService(repo);
    await svc.create({ ...baseInput, body: { name: 'A', code: 'MINE-1' } });
    expect(created[0].code).toBe('MINE-1');
    expect(repo.generateUniqueCode).not.toHaveBeenCalled();

    await svc.create({ ...baseInput, body: { name: 'B', code: '   ' } });
    expect(created[1].code).toBe('PROD-GENERATED');
  });

  it('falls back to the description-less name, and stores a blank barcode as null', async () => {
    const { repo, created } = stubRepo();
    await new ProductService(repo).create({ ...baseInput, body: { name: 'Widget', barcode: '  ' } });
    // null, not '', so @@unique([tenantId, barcode]) treats blanks as distinct.
    expect(created[0].barcode).toBeNull();
    expect(created[0].description).toBe('Widget');
    // product_image goes the other way on purpose.
    expect(created[0].product_image).toBe('');
  });

  it('writes an Inventory row for a tracked product even at zero stock', async () => {
    const { repo, inventory } = stubRepo();
    await new ProductService(repo).create({
      ...baseInput,
      body: { name: 'Widget', enable_inventory: 'true', stock: '0' },
    });
    expect(inventory).toHaveLength(1);
    // The row is scoped to the WORKSPACE — invoice COGS reads inventory by
    // tenant, so a per-user id here would hide stock from other admins.
    expect(inventory[0].tenantId).toBe('t1');
    expect(inventory[0].quantity).toBe(0);
  });

  it('attributes the opening entry to the person, not the workspace', async () => {
    const { repo, inventory } = stubRepo();
    await new ProductService(repo).create({
      ...baseInput,
      body: { name: 'Widget', enable_inventory: 'true', stock: '3' },
    });
    const history = inventory[0].inventory_history as { createdBy: string; type: string }[];
    expect(history[0].createdBy).toBe('u1');
    expect(history[0].type).toBe('stock_in');
  });

  it('writes no Inventory row when there is no actor on the request', async () => {
    const { repo, inventory } = stubRepo();
    await new ProductService(repo).create({
      ...baseInput,
      hasActor: false,
      body: { name: 'Widget', enable_inventory: 'true', stock: '3' },
    });
    expect(inventory).toHaveLength(0);
  });

  it('only defaults the tax rate when neither a rate nor a group was named', async () => {
    const { repo, created } = stubRepo();
    const svc = new ProductService(repo);

    await svc.create({ ...baseInput, body: { name: 'A' } });
    expect(created[0].taxRateId).toBe('none-rate');

    await svc.create({ ...baseInput, body: { name: 'B', taxRateId: 'rate-9' } });
    expect(created[1].taxRateId).toBe('rate-9');

    // A legacy tax-group id means "the group decides"; no default rate.
    await svc.create({ ...baseInput, body: { name: 'C', tax: 'group-1' } });
    expect(created[2].taxRateId).toBeNull();
    expect(created[2].taxGroupId).toBe('group-1');
  });

  // status is parsed as `!== 'false'`, so a real boolean false still creates an
  // active product. Update handles both. Pinned, not corrected.
  it('treats only the string "false" as inactive on create', async () => {
    const { repo, created } = stubRepo();
    const svc = new ProductService(repo);
    await svc.create({ ...baseInput, body: { name: 'A', status: 'false' } });
    expect(created[0].status).toBe(false);
    await svc.create({ ...baseInput, body: { name: 'B', status: false as unknown as string } });
    expect(created[1].status).toBe(true);
  });
});

describe('ProductService.update', () => {
  it('backfills an Inventory row when tracking is newly on', async () => {
    const { repo, inventory } = stubRepo({
      updateProduct: vi.fn(async () => ({ id: 'p1', enable_inventory: true, stock: 7, unitId: 'u' }) as never),
    });
    await new ProductService(repo).update({
      id: 'p1', tenantId: 't1', actingUserId: 'u1', hasActor: true,
      data: {}, rawCustomFields: undefined, files: [],
    });
    expect(inventory).toHaveLength(1);
    expect(inventory[0].quantity).toBe(7);
  });

  it('does not duplicate an Inventory row that already exists', async () => {
    const { repo, inventory } = stubRepo({
      updateProduct: vi.fn(async () => ({ id: 'p1', enable_inventory: true, stock: 7, unitId: 'u' }) as never),
      findInventoryInTx: vi.fn(async () => ({ id: 'inv1' }) as never),
    });
    await new ProductService(repo).update({
      id: 'p1', tenantId: 't1', actingUserId: 'u1', hasActor: true,
      data: {}, rawCustomFields: undefined, files: [],
    });
    expect(inventory).toHaveLength(0);
  });
});

describe('ProductService.mergeLiveStock', () => {
  const svc = new ProductService(stubRepo().repo);

  // `has()` then `get()`, not `??` — a live quantity of 0 must win.
  it('lets a live quantity of zero override the frozen stock', () => {
    const merged = svc.mergeLiveStock([{ id: 'p1', stock: 5 }], [{ productId: 'p1', quantity: 0 }]);
    expect(merged[0].stock).toBe(0);
  });

  it('overrides with a nonzero live quantity', () => {
    const merged = svc.mergeLiveStock([{ id: 'p1', stock: 5 }], [{ productId: 'p1', quantity: 42 }]);
    expect(merged[0].stock).toBe(42);
  });

  // The detail endpoint reports 0 for the same case. Divergence preserved.
  it('keeps the product stock when there is no Inventory row', () => {
    const merged = svc.mergeLiveStock([{ id: 'p1', stock: 5 }], []);
    expect(merged[0].stock).toBe(5);
  });

  it('leaves other fields untouched', () => {
    const merged = svc.mergeLiveStock(
      [{ id: 'p1', stock: 5, name: 'Widget' }],
      [{ productId: 'p1', quantity: 1 }],
    );
    expect(merged[0].name).toBe('Widget');
  });
});
