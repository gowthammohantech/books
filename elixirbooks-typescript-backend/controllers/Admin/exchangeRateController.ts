// controllers/Admin/exchangeRateController.ts
// Task G.6 — Tenant-scoped CRUD for manual exchange rates.
// All endpoints require `protect` middleware (set in adminRoutes.js).

import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { requireUserId, UnauthorizedError } from '../../lib/tenantScope';

function handleUnauthorized(res: Response, err: unknown): boolean {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).json({ success: false, message: err.message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET /exchange-rates
// Optional query filters: fromCurrency, toCurrency
// ---------------------------------------------------------------------------

export async function listExchangeRates(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromCurrency, toCurrency } = req.query as {
      fromCurrency?: string;
      toCurrency?: string;
    };

    const where: Prisma.ExchangeRateWhereInput = { userId };
    if (fromCurrency) where.fromCurrency = fromCurrency;
    if (toCurrency) where.toCurrency = toCurrency;

    const rates = await prisma.exchangeRate.findMany({
      where,
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { asOfDate: 'desc' }],
    });

    res.status(200).json({ success: true, data: rates });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('listExchangeRates error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching exchange rates',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// POST /exchange-rates
// Body: { fromCurrency, toCurrency, rate, asOfDate }
// ---------------------------------------------------------------------------

export async function createExchangeRate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { fromCurrency, toCurrency, rate, asOfDate } = req.body as {
      fromCurrency?: string;
      toCurrency?: string;
      rate?: number | string;
      asOfDate?: string;
    };

    if (!fromCurrency || !toCurrency || rate == null || !asOfDate) {
      res.status(400).json({
        success: false,
        message: 'fromCurrency, toCurrency, rate, and asOfDate are required',
      });
      return;
    }

    let parsedRate: Prisma.Decimal;
    try {
      parsedRate = new Prisma.Decimal(String(rate));
      if (parsedRate.lte(0)) throw new Error('non-positive');
    } catch {
      res.status(400).json({ success: false, message: 'rate must be a positive number' });
      return;
    }

    const parsedDate = new Date(asOfDate);
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ success: false, message: 'asOfDate is not a valid date' });
      return;
    }

    const created = await prisma.exchangeRate.create({
      data: {
        userId,
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        rate: parsedRate,
        asOfDate: parsedDate,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('createExchangeRate error:', err);
    res.status(500).json({
      success: false,
      message: 'Error creating exchange rate',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// DELETE /exchange-rates/:id
// Tenant-scoped: only the owning userId may delete their rate.
// ---------------------------------------------------------------------------

export async function deleteExchangeRate(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.exchangeRate.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      res.status(404).json({ success: false, message: 'Exchange rate not found' });
      return;
    }

    await prisma.exchangeRate.delete({ where: { id } });

    res.status(200).json({ success: true, data: { id } });
  } catch (err) {
    if (handleUnauthorized(res, err)) return;
    console.error('deleteExchangeRate error:', err);
    res.status(500).json({
      success: false,
      message: 'Error deleting exchange rate',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// CommonJS interop for legacy JS routes
module.exports = { listExchangeRates, createExchangeRate, deleteExchangeRate };
module.exports.listExchangeRates = listExchangeRates;
module.exports.createExchangeRate = createExchangeRate;
module.exports.deleteExchangeRate = deleteExchangeRate;
