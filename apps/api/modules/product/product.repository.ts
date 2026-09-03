/**
 * Every Prisma call the Products API makes, in one place.
 *
 * This is the pilot for the wider controller/service/repository split, so the
 * choices here set the pattern for the other twelve domains.
 *
 * IT TAKES THE SHARED CLIENT BY DEFAULT, and that is load-bearing rather than
 * convenience. `tests/tenant/catalogScope.test.ts` and `crossTenantLeak.test.ts`
 * mock the `lib/prisma` MODULE and then assert on the arguments the delegates
 * received — they check that every `where` names a tenant. Resolving the client
 * through a default parameter keeps those two suites pointed at a real subject;
 * constructor-injecting a fake from the controller would leave them asserting
 * against a stub nobody calls, silently passing while proving nothing.
 *
 * EVERY METHOD AWAITS INTERNALLY. `lib/tenantContext.ts:76-86` starts lazily
 * evaluated Prisma thenables inside the AsyncLocalStorage scope; returning an
 * un-awaited query builder from here would let it start outside, which is how a
 * query escapes tenant scoping. No method returns a bare thenable.
 *
 * IT PRESERVES SHAPES IT DOES NOT AGREE WITH. Three different `include` shapes
 * for the same relation, an update whose `where` omits `tenantId`, a hard delete
 * — all reproduced exactly, because this commit is a move and the golden capture
 * has to come out byte-identical. Each is called out where it appears.
 */
import type { Prisma, PrismaClient, Product } from '@prisma/client';

import { prisma } from '../../lib/prisma';

/**
 * Relation shape used when reading a product back after CREATE.
 * `taxGroup` uses `include`; the list uses `select`. Both hand
 * `resolveProductTaxRate` the isActive/isDeleted/regime it needs to filter on.
 */
const CREATE_READBACK_INCLUDE = {
  category: { select: { id: true, category_name: true } },
  brand: { select: { id: true, brand_name: true } },
  unit: { select: { id: true, unit_name: true, short_name: true } },
  taxGroup: {
    include: {
      tax_rates: {
        select: { id: true, name: true, rate: true, isActive: true, isDeleted: true, regime: true },
      },
    },
  },
  taxRate: { select: { id: true, name: true, rate: true } },
} as const;

/** Relation shape used by the LIST. Note `select` on taxGroup, not `include`. */
const LIST_INCLUDE = {
  category: { select: { id: true, category_name: true } },
  brand: { select: { id: true, brand_name: true } },
  unit: { select: { id: true, unit_name: true, short_name: true } },
  taxGroup: {
    select: {
      id: true,
      tax_name: true,
      tax_rates: {
        select: { id: true, name: true, rate: true, isActive: true, isDeleted: true, regime: true },
      },
    },
  },
  taxRate: { select: { id: true, name: true, rate: true } },
} as const;

/**
 * Relation shape used by GET BY ID: full relation rows.
 *
 * Deliberately the widest of the three — the detail response spreads the row at
 * the top level, so callers see every column of every relation. Narrowing it to
 * match the list would change the response body.
 */
const DETAIL_INCLUDE = {
  category: true,
  brand: true,
  unit: true,
  taxGroup: { include: { tax_rates: true } },
  taxRate: { select: { id: true, name: true, rate: true } },
} as const;

export interface ListProductsArgs {
  where: Prisma.ProductWhereInput;
  skip: number;
  take: number;
}

export class ProductRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  /** The tenant's default "no tax" rate, used when a create names no tax at all. */
  async findDefaultNoneTaxRate(tenantId: string): Promise<{ id: string } | null> {
    return await this.db.taxRate.findFirst({
      where: { tenantId, regime: 'NONE', isActive: true, isDeleted: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  /**
   * A free product code.
   *
   * Takes the transaction client, because the caller generates the code inside
   * the same transaction that inserts the row. The clash check is advisory —
   * `@@unique([tenantId, code])` is the real guarantee, and the timestamp
   * fallback after five attempts can itself collide under concurrency.
   */
  async generateUniqueCode(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = `PROD-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
      const clash = await tx.product.findFirst({
        where: { tenantId, code: candidate },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    return `PROD-${Date.now().toString(36).toUpperCase()}`;
  }

  async createProduct(
    tx: Prisma.TransactionClient,
    data: Prisma.ProductUncheckedCreateInput,
  ): Promise<Product> {
    return await tx.product.create({ data });
  }

  /**
   * Update by id.
   *
   * PRESERVED AS FOUND: the `where` carries no `tenantId`, relying on the
   * tenant-scoped `findOwned` the caller ran first — which is outside the
   * transaction, so it is a time-of-check/time-of-use window rather than a
   * closed door. Narrowing it here would be a behaviour change smuggled into a
   * refactor; it belongs in its own commit with its own reasoning.
   */
  async updateProduct(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.ProductUpdateInput,
  ): Promise<Product> {
    return await tx.product.update({ where: { id }, data });
  }

  /** Tenant-scoped existence check, no relations. */
  async findOwned(id: string, tenantId: string): Promise<Product | null> {
    return await this.db.product.findFirst({ where: { id, tenantId } });
  }

  /** Read-back after a create, with the create-path relation shape. */
  async findForCreateResponse(id: string, tenantId: string) {
    return await this.db.product.findFirst({
      where: { id, tenantId },
      include: CREATE_READBACK_INCLUDE,
    });
  }

  /** Read for the detail endpoint, with full relation rows. */
  async findDetail(id: string, tenantId: string) {
    return await this.db.product.findFirst({ where: { id, tenantId }, include: DETAIL_INCLUDE });
  }

  async countProducts(where: Prisma.ProductWhereInput): Promise<number> {
    return await this.db.product.count({ where });
  }

  async listProducts({ where, skip, take }: ListProductsArgs) {
    return await this.db.product.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  /**
   * Delete a product and its inventory.
   *
   * PRESERVED AS FOUND on two counts: this is a HARD delete (Product has no
   * `isDeleted` column, unlike most models here — the controller comment
   * explains it mirrors the pre-Postgres `findByIdAndDelete`), and the
   * `product.delete` `where` omits `tenantId` for the same reason `updateProduct`
   * does. It also uses the ARRAY form of $transaction, where every other write
   * path in this file uses the callback form — worth normalising, but not here.
   * InventoryCostLayer rows are not touched and will orphan.
   */
  async deleteWithInventory(id: string, tenantId: string): Promise<void> {
    await this.db.$transaction([
      this.db.inventory.deleteMany({ where: { productId: id, tenantId } }),
      this.db.product.delete({ where: { id } }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  /**
   * Live quantities for a page of products, in one query rather than per row.
   *
   * Returns the rows; the caller decides the merge. It does NOT filter
   * `isDeleted: false`, so a soft-deleted Inventory row still shadows
   * `Product.stock` — as it does today.
   */
  async findInventoryForProducts(productIds: string[], tenantId: string) {
    return await this.db.inventory.findMany({
      where: { productId: { in: productIds }, tenantId },
      select: { productId: true, quantity: true },
    });
  }

  async findInventoryQuantity(productId: string, tenantId: string) {
    return await this.db.inventory.findFirst({
      where: { productId, tenantId },
      select: { quantity: true },
    });
  }

  async findInventoryInTx(tx: Prisma.TransactionClient, productId: string, tenantId: string) {
    return await tx.inventory.findFirst({ where: { productId, tenantId } });
  }

  async createInventory(
    tx: Prisma.TransactionClient,
    data: Prisma.InventoryUncheckedCreateInput,
  ): Promise<void> {
    await tx.inventory.create({ data });
  }

  async listCostLayers(tenantId: string, productId: string) {
    return await this.db.inventoryCostLayer.findMany({
      where: { tenantId, productId, isDeleted: false },
      orderBy: { receivedAt: 'asc' },
    });
  }

  // -------------------------------------------------------------------------
  // Catalogue lookups
  //
  // All four take `take: undefined` when searching, which Prisma treats as "no
  // limit" — so a search returns everything and an unsearched list returns 10.
  // -------------------------------------------------------------------------

  async listCategories(where: Prisma.CategoryWhereInput, take: number | undefined) {
    return await this.db.category.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  }

  async listBrands(where: Prisma.BrandWhereInput, take: number | undefined) {
    return await this.db.brand.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  }

  async listUnits(where: Prisma.UnitWhereInput, take: number | undefined) {
    return await this.db.unit.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  }

  async listTaxGroups(where: Prisma.TaxGroupWhereInput, take: number | undefined) {
    return await this.db.taxGroup.findMany({
      where,
      include: { tax_rates: true },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  /** Callback-form $transaction, so the caller can sequence writes. */
  async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return await this.db.$transaction(fn);
  }
}

/** The instance the controller uses. One per process; it holds no state. */
export const productRepository = new ProductRepository();
