import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireUserId } from '../../lib/tenantScope';
import { COUNTRY_PACKS, COUNTRY_CODES } from '../../lib/ledger/packs';
import { applyPack, type ApplyPackTx } from '../../lib/ledger/applyPack';
import { LedgerError } from '../../lib/ledger/buildLines';
import { seedTransactionCategoriesForUser } from '../../prisma/seedTransactionCategories';
import { ensureDefaultTaxGroup } from '../../lib/tax/ensureDefaultTaxGroup';

export async function listCountryPacks(_req: Request, res: Response): Promise<void> {
  const packs = COUNTRY_CODES.map((code) => {
    const p = COUNTRY_PACKS[code];
    return {
      countryCode: p.countryCode, name: p.name,
      defaultFunctionalCurrency: p.defaultFunctionalCurrency,
      fiscalYearStartMonth: p.fiscalYearStartMonth,
      taxRegime: p.taxRegime, accountCount: p.accounts.length,
    };
  });
  res.json({ success: true, data: { packs } });
}

export async function ledgerStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const s = await prisma.companySettings.findFirst({
      where: { userId },
      select: {
        countryCode: true,
        functionalCurrency: true,
        fiscalYearStartMonth: true,
        goLiveDate: true,
        ledgerInitialized: true,
      },
    });
    res.json({
      success: true,
      data: {
        configured: !!s?.countryCode,
        ledgerInitialized: !!s?.ledgerInitialized,
        countryCode: s?.countryCode ?? null,
        functionalCurrency: s?.functionalCurrency ?? null,
        fiscalYearStartMonth: s?.fiscalYearStartMonth ?? null,
        goLiveDate: s?.goLiveDate ?? null,
      },
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'UnauthorizedError') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    console.error('ledgerStatus error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger status' });
  }
}

export async function applyCountryPack(req: Request, res: Response): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { countryCode, functionalCurrency, fiscalYearStartMonth, goLiveDate } = req.body ?? {};
    if (!countryCode || !COUNTRY_CODES.includes(countryCode)) {
      res.status(400).json({ success: false, message: 'Invalid or unsupported countryCode' });
      return;
    }
    if (!goLiveDate) {
      res.status(400).json({ success: false, message: 'goLiveDate is required' });
      return;
    }
    const goLive = new Date(goLiveDate);
    if (Number.isNaN(goLive.getTime())) {
      res.status(400).json({ success: false, message: 'goLiveDate is invalid' });
      return;
    }
    await prisma.$transaction((tx) =>
      applyPack(tx as unknown as ApplyPackTx, {
        userId, countryCode,
        functionalCurrency: functionalCurrency || undefined,
        fiscalYearStartMonth: fiscalYearStartMonth ? Number(fiscalYearStartMonth) : undefined,
        goLiveDate: goLive,
      }),
    );

    // Ledger is now initialized for this tenant. Seed the Money In/Out
    // transaction-category catalog and ensure a default TaxGroup/TaxRate exist
    // INLINE — so banking dropdowns and product creation work immediately,
    // without waiting for the next deploy/boot. Both are idempotent and
    // best-effort: never let them fail the ledger-setup response.
    try {
      await seedTransactionCategoriesForUser(userId);
      await ensureDefaultTaxGroup(userId);
    } catch (seedErr) {
      console.warn('post-applyPack seed skipped (non-fatal):', seedErr);
    }

    res.json({ success: true, message: 'Ledger configured', data: { countryCode } });
  } catch (err) {
    if (err instanceof LedgerError) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    const name = (err as { name?: string })?.name;
    if (name === 'UnauthorizedError') {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    console.error('applyCountryPack error:', err);
    res.status(500).json({ success: false, message: 'Failed to configure ledger' });
  }
}
