import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import {
  tenantScope,
  requireUserId,
  UnauthorizedError,
} from '../lib/tenantScope';

// =============================================================================
// Helpers
// =============================================================================

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface HistoryEntry {
  type?: string;
  quantity?: number;
  adjustment?: number;
  createdAt?: string | Date;
}

function toHistoryArray(raw: Prisma.JsonValue | null | undefined): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw as HistoryEntry[];
}

// =============================================================================
// getInventoryStockSummary
// =============================================================================

export async function getInventoryStockSummary(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      search = '',
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
    } = req.query as {
      search?: string;
      startDate?: string;
      endDate?: string;
      prevStartDate?: string;
      prevEndDate?: string;
    };

    // Base inventory filter, scoped to the tenant's own stock records.
    const where: Prisma.InventoryWhereInput = { userId, isDeleted: false };

    // Search by product name or sku/code
    if (search) {
      const matchingProducts = await prisma.product.findMany({
        where: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      where.productId = { in: matchingProducts.map((p) => p.id) };
    }

    // Date filter (current period)
    const startD = parseDate(startDate);
    const endD = parseDate(endDate);
    if (startD && endD) {
      where.createdAt = { gte: startD, lte: endD };
    }

    // === Get Current Period Data ===
    const inventoryData = await prisma.inventory.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            code: true,
            alert_quantity: true,
            purchase_price: true,
            selling_price: true,
            status: true,
            categoryId: true,
            unitId: true,
            product_image: true,
          },
        },
      },
    });

    // === Calculate Summary ===
    let totalStockValue = 0;
    let lowStockItems = 0;
    let outOfStockItems = 0;

    inventoryData.forEach((item) => {
      const qty = item.quantity || 0;
      const purchasePrice = asNumber(item.product?.purchase_price, 0);
      const alertQty = item.product?.alert_quantity ?? 0;
      totalStockValue += qty * purchasePrice;
      if (qty === 0) outOfStockItems++;
      if (qty > 0 && qty <= alertQty) lowStockItems++;
    });

    // Placeholder for pending reorders
    const pendingReorders = 0;

    // === Get Previous Period Data (for percentage change) ===
    let percentageChange: {
      totalStockValue: { change: number; direction: string };
      lowStockItems: { change: number; direction: string };
      outOfStockItems: { change: number; direction: string };
      pendingReorders: { change: number; direction: string };
    } = {
      totalStockValue: { change: 0, direction: 'neutral' },
      lowStockItems: { change: 0, direction: 'neutral' },
      outOfStockItems: { change: 0, direction: 'neutral' },
      pendingReorders: { change: 0, direction: 'neutral' },
    };

    const prevStart = parseDate(prevStartDate);
    const prevEnd = parseDate(prevEndDate);
    if (prevStart && prevEnd) {
      const prevWhere: Prisma.InventoryWhereInput = {
        ...where,
        createdAt: { gte: prevStart, lte: prevEnd },
      };

      const prevInventoryData = await prisma.inventory.findMany({
        where: prevWhere,
        include: {
          product: {
            select: {
              alert_quantity: true,
              purchase_price: true,
            },
          },
        },
      });

      let prevStockValue = 0;
      let prevLowStock = 0;
      let prevOutStock = 0;

      prevInventoryData.forEach((item) => {
        const qty = item.quantity || 0;
        const purchasePrice = asNumber(item.product?.purchase_price, 0);
        const alertQty = item.product?.alert_quantity ?? 0;
        prevStockValue += qty * purchasePrice;
        if (qty === 0) prevOutStock++;
        if (qty > 0 && qty <= alertQty) prevLowStock++;
      });

      const calcChange = (current: number, previous: number) => {
        if (previous === 0 && current === 0) return { change: 0, direction: 'neutral' };
        if (previous === 0) return { change: 100, direction: 'up' };
        const change = ((current - previous) / previous) * 100;
        return {
          change: Math.round(change),
          direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        };
      };

      percentageChange = {
        totalStockValue: calcChange(totalStockValue, prevStockValue),
        lowStockItems: calcChange(lowStockItems, prevLowStock),
        outOfStockItems: calcChange(outOfStockItems, prevOutStock),
        pendingReorders: { change: 0, direction: 'neutral' },
      };
    }

    // === Prepare Data List ===
    const dataList = inventoryData.map((item) => ({
      id: item.id,
      type: 'product',
      name: item.product?.name || '',
      sku: item.product?.code || '',
      quantity: item.quantity || 0,
      sellingPrice: asNumber(item.product?.selling_price, 0),
      purchasePrice: asNumber(item.product?.purchase_price, 0),
      alertQuantity: item.product?.alert_quantity || 0,
      status: item.product?.status ? 'active' : 'inactive',
      productImage: item.product?.product_image || '',
      category: item.product?.categoryId || '',
      unit: item.product?.unitId || '',
    }));

    // === Final Response ===
    res.status(200).json({
      success: true,
      message: 'Inventory Stock Summary fetched successfully',
      total: {
        totalStockValue,
        lowStockItems,
        outOfStockItems,
        pendingReorders,
      },
      percentageChange,
      data: dataList,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating inventory stock summary:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating inventory stock summary',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getInventoryReport
// =============================================================================

export async function getInventoryReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    // Product search filter (Product is a shared catalog with no tenant column;
    // it is only ever reached here through the tenant's own Inventory rows below).
    const productFilter: Prisma.ProductWhereInput = {
      status: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Tenant-scoped: only report on stock this tenant actually holds.
    const inventoryFilter: Prisma.InventoryWhereInput = {
      userId,
      isDeleted: false,
      product: productFilter,
    };

    // ----------------------------
    // 1. Totals (manually aggregated)
    // ----------------------------
    const inventoriesForTotals = await prisma.inventory.findMany({
      where: inventoryFilter,
      select: {
        quantity: true,
        product: { select: { alert_quantity: true, selling_price: true } },
      },
    });

    let totalValues = 0;
    let lowStockItemsCount = 0;
    let outOfStockItemsCount = 0;

    inventoriesForTotals.forEach((inv) => {
      const stockQty = inv.quantity ?? 0;
      const sellingPrice = asNumber(inv.product?.selling_price, 0);
      totalValues += stockQty * sellingPrice;
      if (inv.product && stockQty > 0 && stockQty <= inv.product.alert_quantity) lowStockItemsCount++;
      if (stockQty === 0) outOfStockItemsCount++;
    });

    const totalProducts = inventoriesForTotals.length;

    // ----------------------------
    // 2. Paginated records
    // ----------------------------
    const inventoryRows = await prisma.inventory.findMany({
      where: inventoryFilter,
      include: {
        product: {
          include: {
            unit: { select: { unit_name: true, short_name: true } },
            category: {
              select: { category_name: true, slug: true, category_image: true, status: true },
            },
          },
        },
      },
      skip,
      take: limitN,
    });

    const data = inventoryRows
      .filter((inv) => inv.product)
      .map((inv) => {
        const product = inv.product;
        const stockQty = inv.quantity ?? 0;
        return {
          id: product.id,
          type: product.item_type.toLowerCase(),
          name: product.name,
          sku: product.code,
          sellingPrice: Number(product.selling_price),
          purchasePrice: Number(product.purchase_price),
          currencyCode: product.currencyCode ?? null,
          alertQuantity: product.alert_quantity,
          thumbnail: product.product_image
            ? `${process.env.BASE_URL ?? ''}${product.product_image}`
            : null,
          unit: product.unit ? product.unit.unit_name : null,
          categoryName: product.category ? product.category.category_name : '',
          stock: stockQty,
        };
      });

    // ----------------------------
    // 3. Response
    // ----------------------------
    res.status(200).json({
      success: true,
      message: 'Inventory report fetched successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
      },
      data: {
        totalValues,
        lowStockItems: lowStockItemsCount,
        outOfStockItems: outOfStockItemsCount,
      },
      records: data,
      pagination: {
        total: totalProducts,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(totalProducts / limitN),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating inventory report:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating inventory report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getBestSellerReport
// =============================================================================

export async function getBestSellerReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    // Date ranges for current and previous months
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const customStart = parseDate(startDate);
    const customEnd = parseDate(endDate);
    const hasCustom = !!(customStart && customEnd);

    const productFilter: Prisma.ProductWhereInput = {
      status: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Tenant-scoped: only this tenant's inventory rows, joined to the shared
    // Product catalog via the product relation.
    const inventoryFilter: Prisma.InventoryWhereInput = {
      userId,
      isDeleted: false,
      product: productFilter,
    };

    // Paginated rows for display + the FULL filtered set for the summary tiles.
    // Totals/averages/highest must be computed over every matching product, not
    // just the current page, or they would change as the user pages.
    const summaryInclude = {
      product: {
        include: { category: { select: { category_name: true } } },
      },
    } satisfies Prisma.InventoryInclude;
    const [inventoryRows, allInventoryRows, totalProducts] = await Promise.all([
      prisma.inventory.findMany({
        where: inventoryFilter,
        include: summaryInclude,
        skip,
        take: limitN,
      }),
      prisma.inventory.findMany({ where: inventoryFilter, include: summaryInclude }),
      prisma.inventory.count({ where: inventoryFilter }),
    ]);

    const filterHistory = (entries: HistoryEntry[], start: Date, end: Date): HistoryEntry[] =>
      entries.filter((h) => {
        if (h.type !== 'stock_out') return false;
        const created = h.createdAt ? new Date(h.createdAt) : null;
        if (!created || Number.isNaN(created.getTime())) return false;
        return created >= start && created <= end;
      });

    type InvRow = (typeof allInventoryRows)[number];
    const soldAmounts = (
      inv: InvRow,
    ): { current: number; previous: number; qtyCurrent: number; lastEntry: HistoryEntry | null } => {
      const history = toHistoryArray(inv.inventory_history);
      const currentHistory = hasCustom
        ? filterHistory(history, customStart as Date, customEnd as Date)
        : filterHistory(history, startOfCurrentMonth, endOfCurrentMonth);
      const previousHistory = hasCustom
        ? []
        : filterHistory(history, startOfPreviousMonth, endOfPreviousMonth);
      const qtyCurrent = currentHistory.reduce((sum, h) => sum + Math.abs(asNumber(h.adjustment, 0)), 0);
      const qtyPrevious = previousHistory.reduce((sum, h) => sum + Math.abs(asNumber(h.adjustment, 0)), 0);
      const sellingPrice = asNumber(inv.product?.selling_price, 0);
      return {
        current: qtyCurrent * sellingPrice,
        previous: qtyPrevious * sellingPrice,
        qtyCurrent,
        lastEntry: currentHistory.length ? currentHistory[currentHistory.length - 1] : null,
      };
    };

    // Summary metrics over the ENTIRE filtered set.
    let totalSalesCurrent = 0;
    let totalSalesPrevious = 0;
    let productCount = 0;
    let highestProduct = 'N/A';
    let highestAmount = -1;
    for (const inv of allInventoryRows) {
      if (!inv.product) continue;
      productCount += 1;
      const { current, previous } = soldAmounts(inv);
      totalSalesCurrent += current;
      totalSalesPrevious += previous;
      if (current > highestAmount) {
        highestAmount = current;
        highestProduct = inv.product.name;
      }
    }

    const data = inventoryRows
      .filter((inv) => inv.product)
      .map((inv) => {
        const product = inv.product;
        const { current, qtyCurrent, lastEntry } = soldAmounts(inv);
        const lastEntryDate = lastEntry?.createdAt ? new Date(lastEntry.createdAt) : null;

        return {
          sku: product.code,
          product: product.name,
          category: product.category?.category_name || 'N/A',
          sold_amount: current.toFixed(2),
          sold_quantity: qtyCurrent,
          due_date:
            lastEntryDate && !Number.isNaN(lastEntryDate.getTime())
              ? lastEntryDate.toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : 'N/A',
          payment_mode: 'Cash',
          image: product.product_image
            ? `${process.env.BASE_URL ?? ''}${product.product_image}`
            : '',
        };
      });

    // Average sales over the full filtered set.
    const avgSalesCurrent = productCount > 0 ? totalSalesCurrent / productCount : 0;
    const avgSalesPrevious = productCount > 0 ? totalSalesPrevious / productCount : 0;

    const calcChange = (current: number, previous: number) => {
      if (previous === 0 && current === 0) return { change: '0.00', direction: 'neutral' };
      if (previous === 0 && current > 0) return { change: '100.00', direction: 'up' };
      const percent = (((current - previous) / previous) * 100).toFixed(2);
      return {
        change: percent,
        direction: current >= previous ? 'up' : 'down',
      };
    };

    const totalChange = calcChange(totalSalesCurrent, totalSalesPrevious);
    const avgChange = calcChange(avgSalesCurrent, avgSalesPrevious);

    const response = {
      totalSales: {
        value: totalSalesCurrent.toFixed(2),
        previous: totalSalesPrevious.toFixed(2),
        change: totalChange.change,
        direction: totalChange.direction,
      },
      averageSales: {
        value: avgSalesCurrent.toFixed(2),
        previous: avgSalesPrevious.toFixed(2),
        change: avgChange.change,
        direction: avgChange.direction,
      },
      accessoriesSales: {
        value: '0.00',
        previous: '0.00',
        change: '100.00',
        direction: 'up',
      },
      highestProduct,
      pagination: {
        total: totalProducts,
        page: pageN,
        limit: limitN,
        pages: Math.ceil(totalProducts / limitN),
      },
      data,
    };

    res.status(200).json({
      success: true,
      message: 'Best seller report fetched',
      report: response,
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating best seller report:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating best seller report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getLowStockReport
// =============================================================================

export async function getLowStockReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const productFilter: Prisma.ProductWhereInput = {
      status: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Tenant-scoped: only this tenant's inventory rows, joined to the shared
    // Product catalog via the product relation.
    const allInventoryRows = await prisma.inventory.findMany({
      where: { userId, isDeleted: false, product: productFilter },
      include: {
        product: {
          include: {
            unit: { select: { unit_name: true, short_name: true } },
            category: {
              select: { category_name: true, slug: true, category_image: true, status: true },
            },
          },
        },
      },
    });

    const lowStockProducts: {
      product: NonNullable<(typeof allInventoryRows)[number]['product']>;
      stockQty: number;
    }[] = [];
    let totalLowStock = 0;
    let totalOutOfStock = 0;

    for (const inv of allInventoryRows) {
      const product = inv.product;
      if (!product) continue;
      const stockQty = inv.quantity ?? 0;

      if (stockQty > 0 && stockQty <= product.alert_quantity) {
        totalLowStock++;
        lowStockProducts.push({ product, stockQty });
      }

      if (stockQty === 0) {
        totalOutOfStock++;
      }
    }

    const paginatedProducts = lowStockProducts.slice(skip, skip + limitN);

    const data = paginatedProducts.map(({ product, stockQty }) => ({
      id: product.id,
      type: product.item_type.toLowerCase(),
      name: product.name,
      sku: product.code,
      sellingPrice: Number(product.selling_price),
      purchasePrice: Number(product.purchase_price),
      currencyCode: product.currencyCode ?? null,
      alertQuantity: product.alert_quantity,
      thumbnail: product.product_image
        ? `${process.env.BASE_URL ?? ''}${product.product_image}`
        : '',
      unit: product.unit ? product.unit.unit_name : null,
      categoryName: product.category?.category_name ?? '',
      stock: stockQty,
    }));

    res.status(200).json({
      success: true,
      message: 'Low stock report fetched successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
      },
      data: {
        lowStockItems: totalLowStock,
        outOfStockItems: totalOutOfStock,
      },
      records: data,
      pagination: {
        total: lowStockProducts.length,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(lowStockProducts.length / limitN),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating low stock report:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating low stock report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getOutStockReport
// =============================================================================

export async function getOutStockReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);
    const skip = (pageN - 1) * limitN;

    const productFilter: Prisma.ProductWhereInput = {
      status: true,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Tenant-scoped: only this tenant's inventory rows, joined to the shared
    // Product catalog via the product relation.
    const allInventoryRows = await prisma.inventory.findMany({
      where: { userId, isDeleted: false, product: productFilter },
      include: {
        product: {
          include: {
            unit: { select: { unit_name: true, short_name: true } },
            category: {
              select: { category_name: true, slug: true, category_image: true, status: true },
            },
          },
        },
      },
    });

    const outOfStockProducts: {
      product: NonNullable<(typeof allInventoryRows)[number]['product']>;
      stockQty: number;
    }[] = [];
    let totalOutOfStock = 0;

    for (const inv of allInventoryRows) {
      const product = inv.product;
      if (!product) continue;
      const stockQty = inv.quantity ?? 0;

      if (stockQty === 0) {
        totalOutOfStock++;
        outOfStockProducts.push({ product, stockQty });
      }
    }

    const paginatedProducts = outOfStockProducts.slice(skip, skip + limitN);

    const data = paginatedProducts.map(({ product, stockQty }) => ({
      id: product.id,
      type: product.item_type.toLowerCase(),
      name: product.name,
      sku: product.code,
      sellingPrice: Number(product.selling_price),
      purchasePrice: Number(product.purchase_price),
      currencyCode: product.currencyCode ?? null,
      alertQuantity: product.alert_quantity,
      thumbnail: product.product_image
        ? `${process.env.BASE_URL ?? ''}${product.product_image}`
        : '',
      unit: product.unit ? product.unit.unit_name : null,
      categoryName: product.category?.category_name ?? '',
      stock: stockQty,
    }));

    res.status(200).json({
      success: true,
      message: 'Out of stock report fetched successfully',
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        search: search || null,
      },
      data: {
        outOfStockItems: totalOutOfStock,
      },
      records: data,
      pagination: {
        total: outOfStockProducts.length,
        page: pageN,
        limit: limitN,
        totalPages: Math.ceil(outOfStockProducts.length / limitN),
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating out of stock report:', err);
    res.status(500).json({
      success: false,
      message: 'Error generating out of stock report',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// getStockHistoryReport
// =============================================================================

export async function getStockHistoryReport(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const {
      page = '1',
      limit = '10',
      search = '',
      startDate,
      endDate,
    } = req.query as {
      page?: string;
      limit?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const pageN = Number(page);
    const limitN = Number(limit);

    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfCurrentMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
    );
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const startFilter = parseDate(startDate) ?? startOfCurrentMonth;
    const endFilter = parseDate(endDate) ?? endOfCurrentMonth;

    const calculateChange = (previous: number, current: number) => {
      if (previous === 0 && current === 0) return 0;
      if (previous === 0) return 100;
      return Math.round((Math.abs(current - previous) / previous) * 100);
    };

    // Compute aggregated counts of history entries across all inventories
    // by walking the JSON inventory_history arrays client-side.
    const calculateStockTransactions = async (
      start: Date,
      end: Date,
    ): Promise<{ stock_in: number; stock_out: number; adjustment: number }> => {
      const rows = await prisma.inventory.findMany({
        where: { userId, isDeleted: false },
        select: { inventory_history: true },
      });
      const totals: { stock_in: number; stock_out: number; adjustment: number } = {
        stock_in: 0,
        stock_out: 0,
        adjustment: 0,
      };
      for (const row of rows) {
        const history = toHistoryArray(row.inventory_history);
        for (const entry of history) {
          const created = entry.createdAt ? new Date(entry.createdAt) : null;
          if (!created || Number.isNaN(created.getTime())) continue;
          if (created < start || created > end) continue;
          const type = entry.type ?? '';
          if (type === 'stock_in') totals.stock_in += 1;
          else if (type === 'stock_out') totals.stock_out += 1;
          else if (type === 'adjustment') totals.adjustment += 1;
        }
      }
      return totals;
    };

    const currentTransactions = await calculateStockTransactions(
      startOfCurrentMonth,
      endOfCurrentMonth,
    );
    const previousTransactions = await calculateStockTransactions(
      startOfPreviousMonth,
      endOfPreviousMonth,
    );

    const totalCurrent =
      currentTransactions.stock_in +
      currentTransactions.stock_out +
      currentTransactions.adjustment;
    const totalPrevious =
      previousTransactions.stock_in +
      previousTransactions.stock_out +
      previousTransactions.adjustment;

    // Build inventory list with per-product history sums (filtered by created date)
    const inventoryWhere: Prisma.InventoryWhereInput = {
      userId,
      isDeleted: false,
      createdAt: { gte: startFilter, lte: endFilter },
    };
    if (search) {
      inventoryWhere.product = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const inventoryRows = await prisma.inventory.findMany({
      where: inventoryWhere,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            code: true,
            selling_price: true,
            product_image: true,
            category: { select: { category_name: true } },
          },
        },
      },
      skip: (pageN - 1) * limitN,
      take: limitN,
    });

    const inventoryData = inventoryRows.map((row) => {
      const history = toHistoryArray(row.inventory_history);
      const sumByType = (t: string) =>
        history
          .filter((h) => h.type === t)
          .reduce((s, h) => s + asNumber(h.quantity, 0), 0);
      return {
        id: row.id,
        name: row.product?.name ?? '',
        sku: row.product?.code ?? '',
        sellingPrice: Number(row.product?.selling_price ?? 0),
        categporyName: row.product?.category?.category_name,
        addedQuantity: sumByType('stock_in'),
        soldQuantity: sumByType('stock_out'),
        defectiveQuantity: sumByType('adjustment'),
        finalQuantity: row.quantity,
        image: row.product?.product_image ?? '',
      };
    });

    res.status(200).json({
      status: true,
      message: 'Stock history report fetched',
      summary: {
        totalTransactions: {
          current: totalCurrent,
          previous: totalPrevious,
          percentage: calculateChange(totalPrevious, totalCurrent),
          direction:
            totalCurrent > totalPrevious
              ? 'up'
              : totalCurrent < totalPrevious
                ? 'down'
                : 'equal',
        },
        stockIn: {
          current: currentTransactions.stock_in,
          previous: previousTransactions.stock_in,
          percentage: calculateChange(
            previousTransactions.stock_in,
            currentTransactions.stock_in,
          ),
          direction:
            currentTransactions.stock_in > previousTransactions.stock_in
              ? 'up'
              : currentTransactions.stock_in < previousTransactions.stock_in
                ? 'down'
                : 'equal',
        },
        stockOut: {
          current: currentTransactions.stock_out,
          previous: previousTransactions.stock_out,
          percentage: calculateChange(
            previousTransactions.stock_out,
            currentTransactions.stock_out,
          ),
          direction:
            currentTransactions.stock_out > previousTransactions.stock_out
              ? 'up'
              : currentTransactions.stock_out < previousTransactions.stock_out
                ? 'down'
                : 'equal',
        },
        creditNotes: {
          current: currentTransactions.adjustment,
          previous: previousTransactions.adjustment,
          percentage: calculateChange(
            previousTransactions.adjustment,
            currentTransactions.adjustment,
          ),
          direction:
            currentTransactions.adjustment > previousTransactions.adjustment
              ? 'up'
              : currentTransactions.adjustment < previousTransactions.adjustment
                ? 'down'
                : 'equal',
        },
      },
      data: inventoryData.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        sellingPrice: item.sellingPrice,
        categporyName: item.categporyName || 'Uncategorized',
        addedQuantity: item.addedQuantity,
        soldQuantity: item.soldQuantity,
        defectiveQuantity: item.defectiveQuantity,
        finalQuantity: item.finalQuantity,
        image: item.image ? `${process.env.BASE_URL ?? ''}${item.image}` : '',
      })),
      pagination: {
        page: pageN,
        limit: limitN,
      },
    });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('Error generating stock history report:', err);
    res.status(500).json({
      status: false,
      message: 'Server Error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Silence unused-import warning for tenantScope (kept for parity)
void tenantScope;

// CommonJS interop for legacy JS routes
module.exports = {
  getInventoryStockSummary,
  getInventoryReport,
  getBestSellerReport,
  getLowStockReport,
  getOutStockReport,
  getStockHistoryReport,
};
module.exports.getInventoryStockSummary = getInventoryStockSummary;
module.exports.getInventoryReport = getInventoryReport;
module.exports.getBestSellerReport = getBestSellerReport;
module.exports.getLowStockReport = getLowStockReport;
module.exports.getOutStockReport = getOutStockReport;
module.exports.getStockHistoryReport = getStockHistoryReport;
