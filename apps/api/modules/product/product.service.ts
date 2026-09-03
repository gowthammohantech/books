/**
 * Product business rules and write orchestration.
 *
 * It takes parsed input, never a `Request`. That is the whole point of the
 * layer: the rules below — what makes an item a Service, when an Inventory row
 * has to exist, which tax id wins — are decisions about products, not about
 * HTTP, and they were previously only reachable by constructing a fake req.
 *
 * WHAT STAYS IN THE CONTROLLER, deliberately:
 *   - reading `req` (files, body, params, query) and resolving tenant/actor;
 *   - every `res.status().json()`, because the ten handlers do not agree on a
 *     response shape and a service that returned a shape would have to pick one.
 *     `createProduct` answers `{message, data}`, `getProductById` spreads the row
 *     with no envelope at all, and `getAllProducts` uses `{success, message,
 *     data}`. Unifying them is a visible API change, not a refactor.
 *   - request validation that answers 400 directly, for the same reason: the
 *     valuationMethod guard replies `{message}` with no `success`, where an
 *     AppError through the central handler would add one.
 */
import type { Prisma, Product } from '@prisma/client';

import { insertCustomFieldValues } from '../../lib/customFieldValues';

import { productRepository, ProductRepository } from './product.repository';

/** Truthy multipart/JSON boolean flag ('true' | '1' | true | 1 → true). */
export function parseBoolFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1;
}

/**
 * Items unification (spec 2026-07-12 §4A): the Product/Service question is
 * derived from inventory tracking when the payload omits item_type. An explicit
 * item_type still wins (legacy API compat); Service still forces inventory off.
 */
export function deriveItemType(explicit: unknown, enableInventory: boolean): 'Product' | 'Service' {
  if (explicit === 'Product' || explicit === 'Service') return explicit;
  return enableInventory ? 'Product' : 'Service';
}

type Body = Record<string, string | undefined>;

export interface CreateProductInput {
  tenantId: string;
  actingUserId: string;
  /** Whether a user is on the request at all — gates the Inventory side-effect. */
  hasActor: boolean;
  body: Body;
  /** Read off the raw body, not the string-typed alias: it may be an array. */
  rawCustomFields: unknown;
  files: Express.Multer.File[];
  productImage: string | null;
  galleryImages: string[];
  currencyCode: string | null;
  valuationMethod?: string;
}

export interface UpdateProductInput {
  id: string;
  tenantId: string;
  actingUserId: string;
  hasActor: boolean;
  data: Prisma.ProductUpdateInput;
  rawCustomFields: unknown;
  files: Express.Multer.File[];
}

export class ProductService {
  constructor(private readonly repo: ProductRepository = productRepository) {}

  /**
   * The tax id a new product should carry.
   *
   * Unified tax (spec 2026-07-12 §4B): prefer the new direct rate id; keep
   * accepting the legacy `tax` (TaxGroup id). When neither is sent, default to
   * the tenant's active 0% NONE rate seeded at onboarding, if any.
   */
  async resolveTaxRateId(body: Body, tenantId: string): Promise<string | null> {
    const explicit = body.taxRateId && String(body.taxRateId).trim() ? body.taxRateId : null;
    if (explicit) return explicit;
    if (body.tax) return null;
    const noneRate = await this.repo.findDefaultNoneTaxRate(tenantId);
    return noneRate?.id ?? null;
  }

  /**
   * One `inventory_history` entry, the shape both write paths record.
   *
   * `createdBy` is the person; the row's `tenantId` is the workspace. That split
   * is deliberate — see the comment on the Inventory writes below.
   */
  private openingStockHistory(product: Product, actingUserId: string): Prisma.InputJsonValue {
    const now = new Date().toISOString();
    return [
      {
        unitId: product.unitId,
        quantity: product.stock,
        type: 'stock_in',
        adjustment: product.stock,
        notes: 'Initial stock entry',
        createdBy: actingUserId,
        createdAt: now,
        updatedAt: now,
      },
    ] as unknown as Prisma.InputJsonValue;
  }

  async create(input: CreateProductInput): Promise<Product> {
    const { body, tenantId } = input;

    const enableInventoryFlag = parseBoolFlag(body.enable_inventory);
    const itemType = deriveItemType(body.item_type, enableInventoryFlag);
    const isService = itemType === 'Service';
    const taxRateId = await this.resolveTaxRateId(body, tenantId);

    return await this.repo.transaction(async (tx) => {
      const code =
        body.code && String(body.code).trim()
          ? body.code
          : await this.repo.generateUniqueCode(tx, tenantId);

      const product = await this.repo.createProduct(tx, {
        tenantId,
        item_type: itemType,
        name: body.name as string,
        code,
        categoryId: body.category ? body.category : null,
        brandId: body.brand ? body.brand : null,
        unitId: body.unit && String(body.unit).trim() ? body.unit : null,
        selling_price: Number(body.selling_price ?? 0),
        purchase_price: Number(body.purchase_price ?? 0),
        discount_type: body.discount_type || 'Fixed',
        discount_value: Number(body.discount_value ?? 0),
        taxGroupId: body.tax ? body.tax : null,
        taxRateId,
        // null, not '', so the @@unique([tenantId, barcode]) treats blanks as
        // distinct. product_image below deliberately does the opposite.
        barcode: body.barcode && String(body.barcode).trim() ? body.barcode : null,
        alert_quantity: isService ? 0 : Number(body.alert_quantity ?? 0),
        description: (body.description || body.name) as string,
        product_image: input.productImage ?? '',
        gallery_images: input.galleryImages,
        // Services are consumable: never tracked in inventory.
        enable_inventory: isService ? false : enableInventoryFlag,
        stock: isService ? 0 : Number(body.stock ?? 0),
        status: body.status !== 'false',
        ...(input.valuationMethod ? { valuationMethod: input.valuationMethod } : {}),
        ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
      });

      // Inventory side-effect: create an Inventory row whenever enable_inventory
      // is on (stock may legitimately be 0 — an opening balance of zero still
      // needs a tracked row, otherwise later stock-in has nothing to update).
      // The row's `tenantId` MUST be the workspace, not the acting user —
      // invoice COGS reads scope inventory by tenant, so a per-user id here
      // would hide stock from other admins in the same workspace. `createdBy`
      // inside inventory_history keeps per-person attribution.
      if (product.enable_inventory && input.hasActor) {
        await this.repo.createInventory(tx, {
          productId: product.id,
          quantity: product.stock,
          tenantId,
          inventory_history: this.openingStockHistory(product, input.actingUserId),
        });
      }

      await insertCustomFieldValues(tx, {
        module: 'product',
        recordId: product.id,
        customFields: input.rawCustomFields,
        files: input.files,
        tenantId,
      });

      return product;
    });
  }

  async update(input: UpdateProductInput): Promise<Product> {
    return await this.repo.transaction(async (tx) => {
      const product = await this.repo.updateProduct(tx, input.id, input.data);

      // Backfill: if inventory tracking is now on but the product has no
      // Inventory row yet (e.g. created before tracking was enabled, or before
      // the #6 fix), create one scoped to the tenant. Stock may be 0.
      if (product.enable_inventory && input.hasActor) {
        const existing = await this.repo.findInventoryInTx(tx, product.id, input.tenantId);
        if (!existing) {
          await this.repo.createInventory(tx, {
            productId: product.id,
            quantity: product.stock,
            tenantId: input.tenantId,
            inventory_history: this.openingStockHistory(product, input.actingUserId),
          });
        }
      }

      await insertCustomFieldValues(tx, {
        module: 'product',
        recordId: product.id,
        customFields: input.rawCustomFields,
        files: input.files,
        tenantId: input.tenantId,
      });

      return product;
    });
  }

  /**
   * Overlay live Inventory quantities onto a page of products.
   *
   * `has()` then `get()` rather than `??`, so a row with quantity 0 correctly
   * overrides Product.stock — which a nullish coalesce would not. A product with
   * no Inventory row keeps its own `stock`, unlike the detail endpoint, which
   * reports 0. That divergence is pre-existing and preserved.
   */
  mergeLiveStock<T extends { id: string; stock: number }>(
    products: T[],
    inventoryRows: { productId: string; quantity: number }[],
  ): (T & { stock: number })[] {
    const byProductId = new Map(inventoryRows.map((r) => [r.productId, r.quantity]));
    return products.map((p) => ({
      ...p,
      stock: byProductId.has(p.id) ? (byProductId.get(p.id) as number) : p.stock,
    }));
  }
}

export const productService = new ProductService();
