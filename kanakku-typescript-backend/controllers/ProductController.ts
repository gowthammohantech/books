import type { Request, Response } from 'express';
import type { Prisma, Product } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { requireUserId, requireActingUserId } from '../lib/tenantScope';
import { insertCustomFieldValues, readCustomFieldValues } from '../lib/customFieldValues';
import { resolveProductTaxRate } from '../lib/tax/resolveProductTaxRate';

// PC.1: resolve the company default currency code (ISO string).
async function resolveDefaultCurrencyCode(): Promise<string | null> {
  const defaultCurrency = await prisma.currency.findFirst({
    where: { isDefault: true, isDeleted: false },
    select: { code: true },
  });
  return defaultCurrency?.code ?? null;
}

// uploadProductFields now uses .any() to accept customField_<id> uploads too.
// req.files is a flat Express.Multer.File[] array; extract named fields manually.
function extractProductFiles(req: Request): {
  filesArray: Express.Multer.File[];
  product_image: string | null;
  gallery_images: string[];
} {
  const filesArray = (req.files as Express.Multer.File[]) ?? [];
  const mainFile = filesArray.find((f) => f.fieldname === 'product_image');
  const product_image = mainFile ? `/uploads/products/${mainFile.filename}` : null;
  const gallery_images = filesArray
    .filter((f) => f.fieldname === 'gallery_images')
    .map((f) => `/uploads/products/${f.filename}`);
  return { filesArray, product_image, gallery_images };
}

function uploadPath(file?: Express.Multer.File): string | null {
  return file ? `/uploads/products/${file.filename}` : null;
}

// A product always needs a unique `code` (machine identity, decoupled from the
// now-non-unique description). Generate one when the caller omits it.
async function generateUniqueProductCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const candidate = `PROD-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    // eslint-disable-next-line no-await-in-loop
    const clash = await tx.product.findFirst({ where: { code: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `PROD-${Date.now().toString(36).toUpperCase()}`;
}

/** Truthy multipart/JSON boolean flag ('true' | '1' | true | 1 → true). */
export function parseBoolFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1;
}

// Items unification (spec 2026-07-12 §4A): the Product/Service question is
// derived from inventory tracking when the payload omits item_type. An explicit
// item_type still wins (legacy API compat); Service still forces inventory off.
export function deriveItemType(explicit: unknown, enableInventory: boolean): 'Product' | 'Service' {
  if (explicit === 'Product' || explicit === 'Service') return explicit;
  return enableInventory ? 'Product' : 'Service';
}

function formatProductResponse(
  product: Product & {
    category?: { id: string; category_name: string } | null;
    brand?: { id: string; brand_name: string } | null;
    unit?: { id: string; unit_name: string; short_name: string } | null;
    taxGroup?:
      | ({
          id: string;
          tax_name: string;
          tax_rates: { id: string; name: string; rate: Prisma.Decimal; isActive: boolean }[];
        })
      | null;
    taxRate?: { id: string; name: string; rate: Prisma.Decimal } | null;
  },
  productImage: string | null,
  galleryImages: string[],
): Record<string, unknown> {
  const taxRates = product.taxGroup?.tax_rates ?? [];
  const totalTaxRate = taxRates.reduce((sum, t) => sum + Number(t.rate ?? 0), 0);
  const sellingPrice = Number(product.selling_price);
  const purchasePrice = Number(product.purchase_price);
  return {
    id: product.id,
    item_type: product.item_type,
    name: product.name,
    code: product.code,
    category: product.category
      ? { id: product.category.id, name: product.category.category_name }
      : null,
    brand: product.brand
      ? { id: product.brand.id, name: product.brand.brand_name }
      : null,
    unit: product.unit
      ? { id: product.unit.id, name: product.unit.short_name }
      : null,
    prices: {
      selling: sellingPrice,
      purchase: purchasePrice,
      selling_with_tax: sellingPrice + (sellingPrice * totalTaxRate) / 100,
      purchase_with_tax: purchasePrice + (purchasePrice * totalTaxRate) / 100,
    },
    discount: {
      type: product.discount_type,
      value: Number(product.discount_value),
    },
    tax: {
      group_id: product.taxGroup?.id,
      group_name: product.taxGroup?.tax_name,
      total_rate: totalTaxRate,
      components: taxRates.map((t) => ({
        rate_id: t.id,
        name: t.name,
        rate: Number(t.rate),
        status: t.isActive,
      })),
    },
    tax_rate: resolveProductTaxRate(product),
    barcode: product.barcode,
    stock: {
      enable_inventory: product.enable_inventory,
      quantity: product.stock,
      alert_quantity: product.alert_quantity,
    },
    description: product.description,
    images: {
      main: productImage,
      gallery: galleryImages,
    },
    status: product.status,
    currencyCode: product.currencyCode ?? null, // PC.1
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const { filesArray, product_image, gallery_images } = extractProductFiles(req);

    const body = req.body as Record<string, string | undefined>;

    const enableInventoryFlag = parseBoolFlag(body.enable_inventory);
    const itemType = deriveItemType(body.item_type, enableInventoryFlag);
    const isService = itemType === 'Service';

    // P3.5: validate valuationMethod — WAC or FIFO only.
    const rawValuationMethod = body.valuationMethod as string | undefined;
    if (rawValuationMethod !== undefined && rawValuationMethod !== 'WAC' && rawValuationMethod !== 'FIFO') {
      res.status(400).json({ message: 'Invalid valuationMethod. Must be WAC or FIFO.' });
      return;
    }

    // PC.1: use caller-supplied currencyCode or fall back to the company default.
    const productCurrencyCode =
      (typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null) ??
      (await resolveDefaultCurrencyCode());

    const userId = requireActingUserId(req);
    const tenantId = requireUserId(req);

    // Unified tax (spec 2026-07-12 §4B): prefer the new direct rate id; keep
    // accepting the legacy `tax` (TaxGroup id). When neither is sent, default
    // to the tenant's active 0% NONE rate (seeded at onboarding), if any.
    let productTaxRateId: string | null =
      body.taxRateId && String(body.taxRateId).trim() ? (body.taxRateId as string) : null;
    if (!productTaxRateId && !body.tax) {
      const noneRate = await prisma.taxRate.findFirst({
        where: { userId: tenantId, regime: 'NONE', isActive: true, isDeleted: false },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      productTaxRateId = noneRate?.id ?? null;
    }

    const created = await prisma.$transaction(async (tx) => {
      const productCode = body.code && String(body.code).trim()
        ? (body.code as string)
        : await generateUniqueProductCode(tx);

      const newProduct = await tx.product.create({
        data: {
          item_type: itemType,
          name: body.name as string,
          code: productCode,
          categoryId: body.category ? (body.category as string) : null,
          brandId: body.brand ? (body.brand as string) : null,
          unitId: body.unit && String(body.unit).trim() ? (body.unit as string) : null,
          selling_price: Number(body.selling_price ?? 0),
          purchase_price: Number(body.purchase_price ?? 0),
          discount_type: (body.discount_type as string) || 'Fixed',
          discount_value: Number(body.discount_value ?? 0),
          taxGroupId: body.tax ? (body.tax as string) : null,
          taxRateId: productTaxRateId,
          barcode: body.barcode && String(body.barcode).trim() ? (body.barcode as string) : null,
          alert_quantity: isService ? 0 : Number(body.alert_quantity ?? 0),
          description: (body.description || body.name) as string,
          product_image: product_image ?? '',
          gallery_images: gallery_images,
          // Services are consumable: never tracked in inventory.
          enable_inventory: isService ? false : enableInventoryFlag,
          stock: isService ? 0 : Number(body.stock ?? 0),
          status: body.status !== 'false',
          // P3.5: valuation method (WAC default → unchanged for existing products)
          ...(rawValuationMethod ? { valuationMethod: rawValuationMethod } : {}),
          // PC.1: currency the product is priced in
          ...(productCurrencyCode ? { currencyCode: productCurrencyCode } : {}),
        },
      });

      // Inventory side-effect: create an Inventory row whenever enable_inventory
      // is on (stock may legitimately be 0 — an opening balance of zero still
      // needs a tracked row, otherwise later stock-in has nothing to update).
      // The row's `userId` MUST be the tenant (company-owner) id — invoice COGS
      // reads scope inventory by tenant, so a per-user id here would hide stock
      // from other admins in the same workspace. `createdBy` keeps per-person
      // attribution (the acting user).
      if (newProduct.enable_inventory && req.user) {
        await tx.inventory.create({
          data: {
            productId: newProduct.id,
            quantity: newProduct.stock,
            userId: requireUserId(req),
            inventory_history: [
              {
                unitId: newProduct.unitId,
                quantity: newProduct.stock,
                type: 'stock_in',
                adjustment: newProduct.stock,
                notes: 'Initial stock entry',
                createdBy: userId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ] as unknown as Prisma.InputJsonValue,
          },
        });
      }

      await insertCustomFieldValues(tx, {
        module: 'product',
        recordId: newProduct.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });

      return newProduct;
    });

    const populated = await prisma.product.findUnique({
      where: { id: created.id },
      include: {
        category: { select: { id: true, category_name: true } },
        brand: { select: { id: true, brand_name: true } },
        unit: { select: { id: true, unit_name: true, short_name: true } },
        taxGroup: {
          include: {
            tax_rates: { select: { id: true, name: true, rate: true, isActive: true, isDeleted: true, regime: true } },
          },
        },
        taxRate: { select: { id: true, name: true, rate: true } },
      },
    });

    res.status(201).json({
      message: 'Product created successfully',
      data: populated
        ? formatProductResponse(populated, product_image, gallery_images)
        : null,
    });
  } catch (err) {
    console.error('Product creation error:', err);
    res.status(500).json({
      message: 'Server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getAllProducts(req: Request, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const search = ((req.query.search as string) ?? '').trim();

    const where: Prisma.ProductWhereInput = {};
    const itemTypeFilter = req.query.item_type as string | undefined;
    if (itemTypeFilter === 'Product' || itemTypeFilter === 'Service') {
      where.item_type = itemTypeFilter;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { brand: { brand_name: { contains: search, mode: 'insensitive' } } },
        { category: { category_name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const tenantId = requireUserId(req);

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: {
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
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Batch-fetch live Inventory rows for this page of products (no N+1).
    const productIds = products.map((p) => p.id);
    const inventoryRows = await (prisma as unknown as Record<string, {
      findMany: (args: unknown) => Promise<{ productId: string; quantity: number }[]>
    }>)['inventory'].findMany({
      where: { productId: { in: productIds }, userId: tenantId },
      select: { productId: true, quantity: true },
    });
    const inventoryByProductId = new Map(inventoryRows.map((r) => [r.productId, r.quantity]));

    const productsWithLiveStock = products.map((p) => ({
      ...p,
      stock: inventoryByProductId.has(p.id) ? inventoryByProductId.get(p.id) : p.stock,
      alert_quantity: p.alert_quantity,
      tax_rate: resolveProductTaxRate(p),
    }));

    res.status(200).json({
      success: true,
      message: 'Products fetched successfully',
      data: {
        products: productsWithLiveStock,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function getProductById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const tenantId = requireUserId(req);

    const [product, inventoryRow] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        include: {
          category: true,
          brand: true,
          unit: true,
          taxGroup: {
            include: { tax_rates: true },
          },
          taxRate: { select: { id: true, name: true, rate: true } },
        },
      }),
      (prisma as unknown as Record<string, {
        findFirst: (args: unknown) => Promise<{ quantity: number } | null>
      }>)['inventory'].findFirst({
        where: { productId: id, userId: tenantId },
        select: { quantity: true },
      }),
    ]);

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const customFields = await readCustomFieldValues(prisma, {
      module: 'product',
      recordId: id,
      moduleSlug: 'product-services',
    });

    // Return live Inventory.quantity instead of frozen Product.stock.
    // Keep the same `stock` field shape so existing callers are unaffected.
    const liveStock = inventoryRow?.quantity ?? 0;

    res.status(200).json({
      ...product,
      stock: liveStock,
      tax_rate: resolveProductTaxRate(product),
      customFields,
    });
  } catch (err) {
    res.status(500).json({
      message: 'Server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const { filesArray, product_image: newMainImage, gallery_images: newGalleryPaths } = extractProductFiles(req);
    const body = req.body as Record<string, unknown>;

    let newProductImagePath = existing.product_image;
    if (newMainImage) newProductImagePath = newMainImage;

    let galleryImages = Array.isArray(existing.gallery_images)
      ? (existing.gallery_images as string[])
      : [];

    if (newGalleryPaths.length > 0) {
      galleryImages = [...galleryImages, ...newGalleryPaths];
    }

    const imagesToRemove = body.images_to_remove;
    const toRemoveList: string[] = Array.isArray(imagesToRemove)
      ? (imagesToRemove as string[])
      : typeof imagesToRemove === 'string'
        ? [imagesToRemove]
        : [];
    if (toRemoveList.length > 0) {
      galleryImages = galleryImages.filter((p) => !toRemoveList.includes(p));
    }

    const data: Prisma.ProductUpdateInput = {
      product_image: newProductImagePath,
      gallery_images: galleryImages,
    };

    // Apply scalar field updates if present.
    const setIfPresent = (key: string, target: keyof Prisma.ProductUpdateInput, transform?: (v: unknown) => unknown) => {
      if (body[key] !== undefined) {
        (data as Record<string, unknown>)[target as string] = transform ? transform(body[key]) : body[key];
      }
    };
    setIfPresent('name', 'name');
    setIfPresent('code', 'code');
    setIfPresent('selling_price', 'selling_price', (v) => Number(v));
    setIfPresent('purchase_price', 'purchase_price', (v) => Number(v));
    setIfPresent('discount_type', 'discount_type');
    setIfPresent('discount_value', 'discount_value', (v) => Number(v));
    setIfPresent('barcode', 'barcode');
    setIfPresent('description', 'description');

    // Items unification (spec 2026-07-12 §4A): explicit item_type wins; when
    // omitted it is derived from an enable_inventory flag if one was sent;
    // otherwise the stored type stays. Service still forces inventory off.
    const incomingType =
      body.item_type !== undefined
        ? (body.item_type as string)
        : body.enable_inventory !== undefined
          ? (parseBoolFlag(body.enable_inventory) ? 'Product' : 'Service')
          : existing.item_type;
    const isService = incomingType === 'Service';

    if (isService) {
      data.item_type = 'Service';
      data.alert_quantity = 0;
      data.stock = 0;
      data.enable_inventory = false;
    } else {
      data.item_type = 'Product';
      setIfPresent('alert_quantity', 'alert_quantity', (v) => Number(v));
      setIfPresent('stock', 'stock', (v) => Number(v));
      if (body.enable_inventory !== undefined) {
        data.enable_inventory = parseBoolFlag(body.enable_inventory);
      }
    }
    if (body.status !== undefined) {
      data.status = body.status !== 'false' && body.status !== false;
    }
    // P3.5: allow updating valuationMethod (WAC|FIFO).
    if (body.valuationMethod !== undefined) {
      const vm = body.valuationMethod as string;
      if (vm !== 'WAC' && vm !== 'FIFO') {
        res.status(400).json({ message: 'Invalid valuationMethod. Must be WAC or FIFO.' });
        return;
      }
      (data as Record<string, unknown>)['valuationMethod'] = vm;
    }
    // PC.1: allow updating currencyCode (null clears it back to legacy/unset).
    if (body.currencyCode !== undefined) {
      (data as Record<string, unknown>)['currencyCode'] =
        typeof body.currencyCode === 'string' && body.currencyCode ? body.currencyCode : null;
    }
    // The frontend appends every field (incl. empty strings) on submit. For the
    // optional relations, an empty string means "no selection" — connect only a
    // real id, otherwise clear the relation. Passing `connect: { id: '' }` to
    // Prisma throws P2025 (record not found) and 500s the whole update — this is
    // what breaks editing a Service that has no category/brand/tax.
    if (body.category !== undefined) {
      data.category = body.category
        ? { connect: { id: body.category as string } }
        : { disconnect: true };
    }
    if (body.brand !== undefined) {
      data.brand = body.brand
        ? { connect: { id: body.brand as string } }
        : { disconnect: true };
    }
    // unit is now an OPTIONAL relation — '' / null clears it ("-no unit-").
    if (body.unit !== undefined) {
      data.unit = body.unit
        ? { connect: { id: body.unit as string } }
        : { disconnect: true };
    }
    if (body.tax !== undefined) {
      data.taxGroup = body.tax
        ? { connect: { id: body.tax as string } }
        : { disconnect: true };
    }
    // Unified tax: new direct rate link; '' clears it. Legacy `tax` keeps working.
    if (body.taxRateId !== undefined) {
      data.taxRate = body.taxRateId
        ? { connect: { id: body.taxRateId as string } }
        : { disconnect: true };
    }

    const userId = requireActingUserId(req);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.product.update({ where: { id }, data });

      // Backfill: if inventory tracking is now on but the product has no
      // Inventory row yet (e.g. created before tracking was enabled, or before
      // the #6 fix), create one scoped to the tenant. Stock may be 0.
      if (result.enable_inventory && req.user) {
        const existingInventory = await tx.inventory.findFirst({
          where: { productId: result.id, userId: requireUserId(req) },
        });
        if (!existingInventory) {
          await tx.inventory.create({
            data: {
              productId: result.id,
              quantity: result.stock,
              userId: requireUserId(req),
              inventory_history: [
                {
                  unitId: result.unitId,
                  quantity: result.stock,
                  type: 'stock_in',
                  adjustment: result.stock,
                  notes: 'Initial stock entry',
                  createdBy: userId,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ] as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }

      await insertCustomFieldValues(tx, {
        module: 'product',
        recordId: result.id,
        customFields: req.body.customFields,
        files: filesArray,
        userId,
      });
      return result;
    });

    res.status(200).json({
      message: 'Product updated successfully',
      data: {
        ...updated,
        currencyCode: updated.currencyCode ?? null, // PC.1
      },
    });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({
      message: 'Server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }
    // Cascade-delete dependent rows (Inventory) before the product. The
    // Mongoose original was a `findByIdAndDelete` (no FK constraints); Postgres
    // enforces them. We mirror the original "hard delete" semantic by
    // wiping the dependent inventory rows first inside a transaction.
    await prisma.$transaction([
      prisma.inventory.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({
      message: 'Server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface ListQuery {
  search?: string;
  status?: string;
}

function buildImageUrl(req: Request, image: string | null): string | null {
  if (!image) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}/`;
  return `${baseUrl}uploads/${image.replace(/\\/g, '/')}`;
}

export async function getAllProductCategories(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status } = req.query as ListQuery;
    const where: Prisma.CategoryWhereInput = {};

    if (search) where.category_name = { contains: search, mode: 'insensitive' };
    if (status === undefined) where.status = true;
    else where.status = status === 'true';

    const categories = await prisma.category.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: search ? undefined : 10,
    });

    const formatted = categories.map((c) => ({
      id: c.id,
      categoryName: c.category_name,
      categoryImage: buildImageUrl(req, c.category_image),
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: search ? 'Search results for categories' : 'Last 10 categories retrieved',
      data: formatted,
      count: formatted.length,
    });
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function getAllProductBrands(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status } = req.query as ListQuery;
    const where: Prisma.BrandWhereInput = {};
    if (search) where.brand_name = { contains: search, mode: 'insensitive' };
    if (status === undefined) where.status = true;
    else where.status = status === 'true';

    const brands = await prisma.brand.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: search ? undefined : 10,
    });

    const formatted = brands.map((b) => ({
      id: b.id,
      brandName: b.brand_name,
      brandImage: buildImageUrl(req, b.brand_image),
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: search ? 'Search results for brands' : 'Last 10 brands retrieved',
      data: formatted,
      count: formatted.length,
    });
  } catch (err) {
    console.error('Error fetching brands:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching brands',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function getAllUnits(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status } = req.query as ListQuery;
    const where: Prisma.UnitWhereInput = {};
    if (search) {
      where.OR = [
        { unit_name: { contains: search, mode: 'insensitive' } },
        { short_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status === undefined) where.status = true;
    else where.status = status === 'true';

    const units = await prisma.unit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: search ? undefined : 10,
    });

    const formatted = units.map((u) => ({
      id: u.id,
      unitName: u.unit_name,
      shortName: u.short_name,
      status: u.status,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: search ? 'Search results for units' : 'Last 10 units retrieved',
      data: formatted,
      count: formatted.length,
    });
  } catch (err) {
    console.error('Error fetching units:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching units',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

export async function getAllTaxGroups(req: Request, res: Response): Promise<void> {
  try {
    const { search = '', status } = req.query as ListQuery;
    const where: Prisma.TaxGroupWhereInput = {};
    if (search) where.tax_name = { contains: search, mode: 'insensitive' };
    if (status === undefined) where.status = true;
    else where.status = status === 'true';

    const taxes = await prisma.taxGroup.findMany({
      where,
      include: { tax_rates: true },
      orderBy: { createdAt: 'desc' },
      take: search ? undefined : 10,
    });

    const formatted = taxes.map((tax) => ({
      id: tax.id,
      taxGroupName: tax.tax_name,
      taxRate: tax.tax_rates,
      merged_tax: resolveProductTaxRate({ taxGroup: tax }),
      status: tax.status,
      createdAt: tax.createdAt,
      updatedAt: tax.updatedAt,
    }));

    res.status(200).json({
      success: true,
      message: search ? 'Search results for tax groups' : 'Last 10 tax groups retrieved',
      data: formatted,
      count: formatted.length,
    });
  } catch (err) {
    console.error('Error fetching tax groups:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching tax groups',
      error:
        process.env.NODE_ENV === 'development'
          ? err instanceof Error
            ? err.message
            : String(err)
          : 'Internal server error',
    });
  }
}

// =============================================================================
// P3.5 — GET /inventory/cost-layers?productId=<id>
// Returns open FIFO cost layers for a product (transparency endpoint).
// =============================================================================

export async function listCostLayers(req: Request, res: Response): Promise<void> {
  try {
    const { productId } = req.query as { productId?: string };
    const userId = (req as Request & { user?: string }).user;

    if (!productId) {
      res.status(400).json({ message: 'productId query parameter is required' });
      return;
    }
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }

    const layers = await prisma.inventoryCostLayer.findMany({
      where: { userId, productId, isDeleted: false },
      orderBy: { receivedAt: 'asc' },
    });

    res.status(200).json({
      success: true,
      message: 'Cost layers retrieved successfully',
      data: layers,
    });
  } catch (err) {
    console.error('Error fetching cost layers:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getAllProductCategories,
  getAllProductBrands,
  getAllUnits,
  getAllTaxGroups,
  listCostLayers,
  parseBoolFlag,
  deriveItemType,
};
module.exports.createProduct = createProduct;
module.exports.getAllProducts = getAllProducts;
module.exports.getProductById = getProductById;
module.exports.updateProduct = updateProduct;
module.exports.deleteProduct = deleteProduct;
module.exports.getAllProductCategories = getAllProductCategories;
module.exports.getAllProductBrands = getAllProductBrands;
module.exports.getAllUnits = getAllUnits;
module.exports.getAllTaxGroups = getAllTaxGroups;
module.exports.listCostLayers = listCostLayers;
module.exports.parseBoolFlag = parseBoolFlag;
module.exports.deriveItemType = deriveItemType;
