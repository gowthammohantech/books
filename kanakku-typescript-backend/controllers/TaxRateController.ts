import type { Request, Response } from 'express';
import type { TaxRate, TaxRegime } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../lib/prisma';
import { tenantScope, requireUserId, UnauthorizedError } from '../lib/tenantScope';

import {
  suggestTaxesForLine,
  resolveLineTaxes,
  computeLineTaxes,
  splitGstRate,
  isUnionTerritoryStateCode,
} from '../lib/taxEngine';
import { ensureGstComponentRates, type ComponentRateDb } from '../lib/tax/ensureGstComponentRates';

interface TaxRateResponse {
  id: string;
  name: string;
  rate: number;
  regime: TaxRegime;
  taxKind: TaxRate['taxKind'];
  countryId: string | null;
  stateId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function formatTaxRate(r: TaxRate): TaxRateResponse {
  return {
    id: r.id,
    name: r.name,
    rate: Number(r.rate),
    regime: r.regime,
    taxKind: r.taxKind,
    countryId: r.countryId,
    stateId: r.stateId,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function getAllTaxRates(req: Request, res: Response): Promise<void> {
  try {
    requireUserId(req);
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '10', 10)));
    const search = ((req.query.search as string) ?? '').trim();
    const regimeFilter = req.query.regime as string | undefined;
    const activeFilter = req.query.isActive as string | undefined;

    const where: Prisma.TaxRateWhereInput = { ...tenantScope(req) };
    // Unified tax: engine-provisioned component rows (CGST/SGST/IGST halves)
    // are plumbing — hidden from the user-facing Taxes list. The engine and
    // GSTR reports query prisma directly and still see them.
    where.isSystemComponent = false;
    if (regimeFilter && ['GST_INDIA', 'VAT_GENERIC', 'US_SALES_TAX', 'NONE'].includes(regimeFilter)) {
      where.regime = regimeFilter as TaxRegime;
    }
    if (activeFilter === 'true' || activeFilter === 'false') {
      where.isActive = activeFilter === 'true';
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      prisma.taxRate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.taxRate.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        taxRates: rows.map(formatTaxRate),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getAllTaxRates error:', err);
    res.status(500).json({ success: false, message: 'Failed to list tax rates' });
  }
}

export async function getTaxRateById(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const row = await prisma.taxRate.findFirst({
      where: { id, userId, isDeleted: false },
    });
    if (!row) {
      res.status(404).json({ success: false, message: 'Tax rate not found' });
      return;
    }
    res.json({ success: true, data: { taxRate: { ...formatTaxRate(row) } } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('getTaxRateById error:', err);
    res.status(500).json({ success: false, message: 'Failed to load tax rate' });
  }
}

export async function createTaxRate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;

    const created = await prisma.taxRate.create({
      data: {
        name: body.name as string,
        rate: new Prisma.Decimal(Number(body.rate)),
        regime: body.regime as TaxRegime,
        taxKind: (body.taxKind as TaxRate['taxKind']) ?? null,
        countryId: (body.countryId as string | null) ?? null,
        stateId: (body.stateId as string | null) ?? null,
        isActive: body.isActive === undefined ? true : body.isActive === true || body.isActive === 'true',
        userId,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Tax rate created',
      data: { taxRate: { ...formatTaxRate(created) } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('createTaxRate error:', err);
    res.status(500).json({ success: false, message: 'Failed to create tax rate' });
  }
}

export async function updateTaxRate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    const existing = await prisma.taxRate.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Tax rate not found' });
      return;
    }

    const data: Prisma.TaxRateUpdateInput = {};
    if (body.name !== undefined) data.name = body.name as string;
    if (body.rate !== undefined) data.rate = new Prisma.Decimal(Number(body.rate));
    if (body.regime !== undefined) data.regime = body.regime as TaxRegime;
    if (body.taxKind !== undefined) data.taxKind = (body.taxKind as TaxRate['taxKind']) ?? null;
    if (body.countryId !== undefined) {
      data.country = body.countryId ? { connect: { id: body.countryId as string } } : { disconnect: true };
    }
    if (body.stateId !== undefined) {
      data.state = body.stateId ? { connect: { id: body.stateId as string } } : { disconnect: true };
    }
    if (body.isActive !== undefined) data.isActive = body.isActive === true || body.isActive === 'true';

    const updated = await prisma.taxRate.update({ where: { id }, data });
    res.json({
      success: true,
      message: 'Tax rate updated',
      data: { taxRate: { ...formatTaxRate(updated) } },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('updateTaxRate error:', err);
    res.status(500).json({ success: false, message: 'Failed to update tax rate' });
  }
}

export async function deleteTaxRate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };
    const existing = await prisma.taxRate.findFirst({ where: { id, userId, isDeleted: false } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Tax rate not found' });
      return;
    }
    await prisma.taxRate.update({ where: { id }, data: { isDeleted: true } });
    res.json({ success: true, message: 'Tax rate deleted' });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('deleteTaxRate error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete tax rate' });
  }
}

/**
 * POST /api/admin/tax-engine/suggest-for-line
 * Body: { customerId?: string }
 * Returns the TaxRate rows the engine would auto-apply on a line for this customer.
 */
export async function suggestForLine(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as { customerId?: string };

    const company = await prisma.companySettings.findUnique({ where: { userId } });
    if (!company) {
      res.status(400).json({ success: false, message: 'Company settings not configured. Set tax regime first.' });
      return;
    }

    let customerCountryId: string | null = null;
    let customerStateId: string | null = null;
    if (body.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: body.customerId, userId, isDeleted: false },
        select: { billingAddress: true, shippingAddress: true },
      });
      // billingAddress is a JSON blob; defensively pull stateId/countryId if present
      const addr = (customer?.billingAddress as { countryId?: string; stateId?: string } | null) ?? null;
      customerCountryId = addr?.countryId ?? null;
      customerStateId = addr?.stateId ?? null;
    }

    const library = await prisma.taxRate.findMany({
      where: { userId, isDeleted: false, isActive: true, regime: company.taxRegime },
    });

    const suggested = suggestTaxesForLine({
      regime: company.taxRegime,
      companyCountryId: company.countryId ?? null,
      companyStateId: company.stateId ?? null,
      customerCountryId,
      customerStateId,
      libraryRates: library,
    });

    res.json({
      success: true,
      data: { taxRates: suggested.map(formatTaxRate) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('suggestForLine error:', err);
    res.status(500).json({ success: false, message: 'Failed to suggest taxes' });
  }
}

/**
 * POST /api/admin/tax-engine/resolve-line
 * Body: { taxableAmount: number, taxRateId?: string, taxGroupId?: string,
 *         customerId?: string, supplierId?: string }
 * Unified tax (spec 2026-07-12 §4B): a `taxRateId` pointing at a single
 * kind-less GST_INDIA rate is synthesized into CGST+SGST (intra-state; UTGST
 * for union territories) or IGST (inter-state) with lazily provisioned
 * per-tenant component rows. Kind-bearing rates and flat regimes resolve to a
 * single component. The legacy `taxGroupId` path is byte-for-byte unchanged.
 */
export async function resolveLine(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const body = req.body as {
      taxableAmount?: unknown;
      taxRateId?: unknown;
      taxGroupId?: unknown;
      customerId?: string;
      supplierId?: string;
    };

    // Validate required inputs: the new rate id OR the legacy group id.
    const hasRateId = typeof body.taxRateId === 'string' && body.taxRateId !== '';
    const hasGroupId = body.taxGroupId !== undefined && body.taxGroupId !== null && body.taxGroupId !== '';
    if (!hasRateId && !hasGroupId) {
      res.status(400).json({ success: false, message: 'taxRateId or taxGroupId is required' });
      return;
    }
    const taxableAmount = Number(body.taxableAmount);
    if (body.taxableAmount === undefined || body.taxableAmount === null || isNaN(taxableAmount)) {
      res.status(400).json({ success: false, message: 'taxableAmount must be a number' });
      return;
    }
    if (taxableAmount < 0) {
      res.status(400).json({ success: false, message: 'taxableAmount must be >= 0' });
      return;
    }

    // Load company settings (same as suggestForLine)
    const company = await prisma.companySettings.findUnique({ where: { userId } });
    if (!company) {
      res.status(400).json({ success: false, message: 'Company settings not configured. Set tax regime first.' });
      return;
    }

    // Legacy group setup — only when no taxRateId was sent (keeps the old
    // error ordering: unknown group 404s before party lookups).
    let regime: TaxRegime = company.taxRegime;
    let groupRateIds: string[] = [];
    if (!hasRateId) {
      const taxGroup = await prisma.taxGroup.findUnique({
        where: { id: body.taxGroupId as string },
        include: { tax_rates: true },
      });
      if (!taxGroup) {
        res.status(404).json({ success: false, message: 'Tax group not found' });
        return;
      }
      const memberRates = taxGroup.tax_rates;
      regime =
        (memberRates.find((r) => r.regime !== null)?.regime as TaxRegime | undefined) ??
        company.taxRegime;
      groupRateIds = memberRates.map((r) => r.id);
    }

    // Load party state/country from customer billingAddress or supplier stateId/countryId
    let partyCountryId: string | null = null;
    let partyStateId: string | null = null;
    let partyStateMissing = true;

    if (body.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: body.customerId, userId, isDeleted: false },
        select: { billingAddress: true },
      });
      let addr = (customer?.billingAddress as { countryId?: string; stateId?: string } | null) ?? null;
      if (!customer) {
        // Legacy Customer lookup missed — the caller may be passing a unified
        // Contact id (the id space /api/admin/contacts now surfaces). Contact
        // rows migrated from a legacy Customer carry legacyCustomerId, so
        // re-resolve through that link and reuse the same billingAddress read
        // above rather than trusting Contact's own free-text address fields
        // (Contact.region is a plain string input, not a State-table id, so
        // it can't be compared against company.stateId).
        const contact = await prisma.contact.findFirst({
          where: { id: body.customerId, userId, isDeleted: false },
          select: { legacyCustomerId: true, countryId: true, region: true },
        });
        if (!contact) {
          res.status(404).json({ success: false, message: 'Customer not found' });
          return;
        }
        if (contact.legacyCustomerId) {
          const linkedCustomer = await prisma.customer.findFirst({
            where: { id: contact.legacyCustomerId, userId, isDeleted: false },
            select: { billingAddress: true },
          });
          addr = (linkedCustomer?.billingAddress as { countryId?: string; stateId?: string } | null) ?? null;
        } else {
          // Native (never-migrated) Contact — best-effort from its own fields.
          addr = { countryId: contact.countryId ?? undefined, stateId: contact.region ?? undefined };
        }
      }
      partyCountryId = addr?.countryId ?? null;
      partyStateId = addr?.stateId ?? null;
      // When stateId is known but countryId is absent (older address data), infer country from
      // the company's countryId so the same-state check in the engine can resolve correctly.
      if (partyStateId !== null && partyCountryId === null) {
        partyCountryId = company.countryId ?? null;
      }
      partyStateMissing = partyStateId === null;
    } else if (body.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: body.supplierId, user_id: userId, isDeleted: false },
        select: { id: true, stateId: true, countryId: true },
      });
      let stateId = supplier?.stateId ?? null;
      let countryId = supplier?.countryId ?? null;
      if (!supplier) {
        // Same unified-Contact fallback as the customerId branch above.
        const contact = await prisma.contact.findFirst({
          where: { id: body.supplierId, userId, isDeleted: false },
          select: { legacySupplierId: true, countryId: true, region: true },
        });
        if (!contact) {
          res.status(404).json({ success: false, message: 'Supplier not found' });
          return;
        }
        if (contact.legacySupplierId) {
          const linkedSupplier = await prisma.supplier.findFirst({
            where: { id: contact.legacySupplierId, user_id: userId, isDeleted: false },
            select: { stateId: true, countryId: true },
          });
          stateId = linkedSupplier?.stateId ?? null;
          countryId = linkedSupplier?.countryId ?? null;
        } else {
          // Native (never-migrated) Contact — best-effort from its own fields.
          stateId = contact.region ?? null;
          countryId = contact.countryId ?? null;
        }
      }
      partyStateId = stateId;
      partyCountryId = countryId;
      if (partyStateId !== null && partyCountryId === null) {
        partyCountryId = company.countryId ?? null;
      }
      partyStateMissing = partyStateId === null;
    }
    // else: no party provided — partyStateMissing stays true

    if (hasRateId) {
      const rateRow = await prisma.taxRate.findFirst({
        where: { id: body.taxRateId as string, userId, isDeleted: false },
      });
      if (!rateRow) {
        res.status(404).json({ success: false, message: 'Tax rate not found' });
        return;
      }

      if (rateRow.regime === 'GST_INDIA' && rateRow.taxKind === null) {
        // Single kind-less GST rate → synthesize the state-aware split.
        const sameCountry =
          company.countryId !== null && partyCountryId !== null &&
          company.countryId === partyCountryId;
        const intraState =
          sameCountry &&
          company.stateId !== null && partyStateId !== null &&
          company.stateId === partyStateId;
        let unionTerritory = false;
        if (intraState && company.stateId) {
          const state = await prisma.state.findUnique({
            where: { id: company.stateId },
            select: { state_code: true },
          });
          unionTerritory = isUnionTerritoryStateCode(state?.state_code);
        }
        const specs = splitGstRate({ totalPercent: Number(rateRow.rate), intraState, unionTerritory });
        // Not race-safe: ensureGstComponentRates' find-or-create has no unique
        // constraint backing it, so concurrent first-resolves for the same
        // (userId, taxKind, rate) can each miss the find and both create a
        // component row. Accepted for now — harmless-but-untidy duplicate
        // system rows, cleanable later via migrateTaxesToRates.
        const components = await ensureGstComponentRates(
          prisma as unknown as ComponentRateDb,
          userId,
          specs,
          rateRow.countryId,
        );
        const { taxes, totalTax } = computeLineTaxes({
          qty: 1,
          rate: taxableAmount,
          appliedTaxes: components.map((c) => ({
            id: c.taxRateId,
            name: c.name,
            taxKind: c.kind,
            rate: c.percent,
          })),
        });
        res.json({ success: true, data: { taxes, totalTax, partyStateMissing } });
        return;
      }

      // Kind-bearing GST rates (legacy direct references) and every flat regime
      // (VAT_UK/VAT_EU/GST_AU/GST_NZ/US_SALES_TAX/VAT_GENERIC/NONE): one
      // component = the rate itself.
      const { taxes, totalTax } = computeLineTaxes({
        qty: 1,
        rate: taxableAmount,
        appliedTaxes: [
          { id: rateRow.id, name: rateRow.name, taxKind: rateRow.taxKind, rate: Number(rateRow.rate) },
        ],
      });
      res.json({ success: true, data: { taxes, totalTax, partyStateMissing } });
      return;
    }

    // Legacy group path (unchanged): load the library, run the engine.
    const library = await prisma.taxRate.findMany({
      where: { userId, isDeleted: false, isActive: true, regime: company.taxRegime },
    });

    const { taxes, totalTax } = resolveLineTaxes({
      taxableAmount,
      regime,
      companyCountryId: company.countryId ?? null,
      companyStateId: company.stateId ?? null,
      partyCountryId,
      partyStateId,
      libraryRates: library,
      groupRateIds,
    });

    res.json({ success: true, data: { taxes, totalTax, partyStateMissing } });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ success: false, message: err.message });
      return;
    }
    console.error('resolveLine error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve line taxes' });
  }
}

// CommonJS interop for adminRoutes.js
const handlers = {
  getAllTaxRates,
  getTaxRateById,
  createTaxRate,
  updateTaxRate,
  deleteTaxRate,
  suggestForLine,
  resolveLine,
};
module.exports = handlers;
module.exports.default = handlers;
