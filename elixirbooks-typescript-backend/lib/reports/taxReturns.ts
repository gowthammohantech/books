// lib/reports/taxReturns.ts
//
// GL-derived period tax-figures lib — the keystone for the country tax-return
// summaries (UK VAT 9-box, AU BAS, NZ GST, EU VAT). Per the Global Constraint:
// figures come FROM the GL tax accounts (output VAT/GST, input VAT/GST) plus the
// revenue/expense accounts for the period — NOT recomputed from invoices — so a
// return reconciles to the Trial Balance movements on those accounts.
//
// ── Tax-account convention (from the investigation) ──────────────────────────
// Every country COA pack is built by lib/ledger/packs/buildStandardPack.ts,
// which emits exactly one OUTPUT_TAX account (code 2100, LIABILITY) and one
// INPUT_TAX account (code 1300; ASSET, or EXPENSE for US sales tax where
// inputTaxIsExpense). The stable identifier is NOT the code or name — it is the
// LEDGER ROLE, persisted per tenant in LedgerAccountMapping(userId, roleKey →
// accountId, @@unique[userId, roleKey]). The posting engine credits OUTPUT_TAX
// on a sale and debits INPUT_TAX on a purchase via these same role mappings
// (lib/ledger/ledgerPosting.ts). So resolveTaxAccounts reads the role mapping —
// pack-agnostic, identical for IN/GB/EU/AU/NZ/US.
//
// ── GL-loading approach ──────────────────────────────────────────────────────
// Mirrors controllers/financialStatementsController.ts#loadAccountBalances and
// lib/reports/agingSubLedger.ts: sum JournalLine.baseDebit/baseCredit over lines
// whose parent JournalEntry is in [from, to] (inclusive, on entryDate),
// tenant-scoped (journalEntry.userId === tenant), excluding soft-deleted
// entries. Money stays in Prisma.Decimal throughout.
//
//   outputTax       = Σ (baseCredit − baseDebit) on OUTPUT_TAX account(s)
//   inputTax        = Σ (baseDebit  − baseCredit) on INPUT_TAX  account(s)
//   salesExTax      = Σ (baseCredit − baseDebit) on INCOME accounts (credit-normal)
//   purchasesExTax  = Σ (baseDebit  − baseCredit) on EXPENSE accounts (debit-normal),
//                     EXCLUDING the INPUT_TAX account when it is EXPENSE-typed
//                     (US) so input tax is not counted twice.
//   salesInclTax    = salesExTax + outputTax
//   purchasesInclTax= purchasesExTax + inputTax

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../prisma';
import { isEuMember } from '../euVat';

const D0 = () => new Prisma.Decimal(0);

/** The prisma slice the lib consumes — typed narrowly so a small in-memory stub
 *  satisfies it in tests and the real client satisfies it in production. */
export type TaxReturnsPrisma = Pick<PrismaClient, 'ledgerAccountMapping' | 'account'>;

export interface ResolvedTaxAccounts {
  outputAccountIds: string[];
  inputAccountIds: string[];
}

export interface TaxFigures {
  outputTax: Prisma.Decimal;
  inputTax: Prisma.Decimal;
  salesExTax: Prisma.Decimal;
  purchasesExTax: Prisma.Decimal;
  salesInclTax: Prisma.Decimal;
  purchasesInclTax: Prisma.Decimal;
}

/**
 * Resolve the tenant's output-tax and input-tax GL account ids via the ledger
 * role mapping (OUTPUT_TAX / INPUT_TAX). Returns arrays so the figures lib stays
 * forward-compatible with regimes that split tax across several accounts
 * (e.g. India CGST/SGST/IGST) — today each role maps to a single account.
 */
export async function resolveTaxAccounts(
  userId: string,
  client: TaxReturnsPrisma = defaultPrisma,
): Promise<ResolvedTaxAccounts> {
  const maps = await client.ledgerAccountMapping.findMany({
    where: { userId, roleKey: { in: ['OUTPUT_TAX', 'INPUT_TAX'] } },
    select: { roleKey: true, accountId: true },
  });
  const outputAccountIds = maps.filter((m) => m.roleKey === 'OUTPUT_TAX').map((m) => m.accountId);
  const inputAccountIds = maps.filter((m) => m.roleKey === 'INPUT_TAX').map((m) => m.accountId);
  return { outputAccountIds, inputAccountIds };
}

/**
 * Load GL-derived tax figures for [from, to] (inclusive), tenant-scoped.
 *
 * Reconciles to the Trial Balance: each figure equals the period MOVEMENT
 * (Σ baseDebit − Σ baseCredit, sign-normalised) on the relevant accounts — the
 * same arithmetic the statements lib uses — so a return ties out to the GL.
 */
export async function loadTaxFigures(
  userId: string,
  from: Date,
  to: Date,
  client: TaxReturnsPrisma = defaultPrisma,
): Promise<TaxFigures> {
  const { outputAccountIds, inputAccountIds } = await resolveTaxAccounts(userId, client);

  // Load every account for the tenant with its period journal-line movement.
  // Identical loader shape to financialStatementsController#loadAccountBalances:
  // sum baseDebit/baseCredit over lines whose entry is in-period, tenant-scoped,
  // not soft-deleted.
  const accounts = await client.account.findMany({
    where: { userId, isDeleted: false },
    select: {
      id: true,
      accountType: true,
      journalLines: {
        where: {
          journalEntry: { userId, isDeleted: false, entryDate: { gte: from, lte: to } },
        },
        select: { baseDebit: true, baseCredit: true },
      },
    },
  });

  const outputSet = new Set(outputAccountIds);
  const inputSet = new Set(inputAccountIds);

  let outputTax = D0();      // credit-normal (liability)
  let inputTax = D0();       // debit-normal
  let salesExTax = D0();     // INCOME, credit-normal
  let purchasesExTax = D0(); // EXPENSE, debit-normal (excl. input-tax-as-expense)

  for (const a of accounts) {
    let debit = D0();
    let credit = D0();
    for (const l of a.journalLines) {
      debit = debit.plus(l.baseDebit);
      credit = credit.plus(l.baseCredit);
    }
    const creditNet = credit.minus(debit); // liability/income normal
    const debitNet = debit.minus(credit);  // asset/expense normal

    if (outputSet.has(a.id)) {
      outputTax = outputTax.plus(creditNet);
    }
    if (inputSet.has(a.id)) {
      inputTax = inputTax.plus(debitNet);
    }
    if (a.accountType === 'INCOME') {
      salesExTax = salesExTax.plus(creditNet);
    } else if (a.accountType === 'EXPENSE' && !inputSet.has(a.id)) {
      // Exclude the INPUT_TAX account when it is EXPENSE-typed (US) so input tax
      // is not double-counted in both inputTax and purchasesExTax.
      purchasesExTax = purchasesExTax.plus(debitNet);
    }
  }

  return {
    outputTax,
    inputTax,
    salesExTax,
    purchasesExTax,
    salesInclTax: salesExTax.plus(outputTax),
    purchasesInclTax: purchasesExTax.plus(inputTax),
  };
}

// =============================================================================
// EU OSS (One-Stop-Shop) — B2C cross-border qualifying-sale classification.
// =============================================================================
//
// Shared by the OSS return (per-destination VAT due, in the controller) and the
// €10,000 distance-selling threshold helper below so the "qualifying sale" rule
// is defined exactly once.
//
// A sale qualifies for OSS (B2C cross-border) when ALL hold:
//   - the supplier (tenant) is an EU member state,
//   - the customer is an EU member state,
//   - customerCountry !== supplierCountry (CROSS-BORDER), and
//   - it is B2C — the invoice is NOT reverse-charge AND the customer has no
//     valid EU VAT number (a valid VAT number ⇒ B2B reverse-charge supply).
//
// Domestic sales (same country), B2B reverse-charge sales, and non-EU customers
// are all EXCLUDED. Structural VAT validity is resolved by the caller (via
// parseVatNumber) and passed in as `customerVatValid` so this classifier stays
// pure and free of euVat-parsing concerns.

import { parseVatNumber } from '../euVat';

/** The €10,000 EU-wide distance-selling threshold (annual, per calendar year). */
export const OSS_THRESHOLD_EUR = 10000;

/** Narrow shape the OSS classifier reads from a (already-resolved) sales invoice. */
export interface OssQualifyingInput {
  /** Supplier (tenant) ISO-2, already resolved + uppercased ('' if none). */
  supplierCountry: string;
  /** Customer (destination) ISO-2, already resolved + uppercased ('' if none). */
  customerCountry: string;
  /** True when the invoice is flagged reverse-charge (B2B intra-community). */
  reverseCharge: boolean;
  /** True when the customer carries a structurally valid EU VAT number. */
  customerVatValid: boolean;
}

/**
 * True iff the sale is a B2C cross-border EU supply that belongs on the OSS
 * return / counts toward the distance-selling threshold. Pure + side-effect free.
 */
export function isOssQualifyingSale(i: OssQualifyingInput): boolean {
  const supplier = (i.supplierCountry || '').trim().toUpperCase();
  const customer = (i.customerCountry || '').trim().toUpperCase();
  return (
    isEuMember(supplier) &&
    isEuMember(customer) &&
    supplier !== customer &&
    !i.reverseCharge &&
    !i.customerVatValid
  );
}

// ── Supplier / customer resolution (shared with the OSS return) ───────────────
//
// Same approach as lib/tax/serverAuthoritativeTax.ts#resolveSupplierCountry and
// the EC Sales List in the controller: prefer the modern ISO-2 fields, fall back
// to the legacy `countryId` → Country.iso2 via a batch-resolved `iso2ById` map.

/** Normalise a country value to a real ISO-2 code. 'EU' (the pack code) → ''. */
function ossNormIso2(value: string | null | undefined): string {
  const v = (value ?? '').trim().toUpperCase();
  if (v === 'EU' || !/^[A-Z]{2}$/.test(v)) return '';
  return v;
}

/** Contact fields the OSS resolver reads (modern + legacy). */
export interface OssContact {
  vatNumber: string | null;
  vatRegNumber: string | null;
  country: string | null;
  countryId: string | null;
}

/** The narrow invoice shape the OSS aggregation consumes. */
export interface OssInvoice {
  taxableAmount: Prisma.Decimal;
  reverseCharge: boolean | null;
  contact: OssContact | null;
  billToContact?: OssContact | null;
}

/**
 * Resolve the supplier (tenant) ISO-2 from CompanySettings, mirroring
 * serverAuthoritativeTax#resolveSupplierCountry: countryCode → countryId→iso2 →
 * country string. Returns '' when nothing resolves.
 */
export async function resolveOssSupplierCountry(
  client: Pick<PrismaClient, 'country'>,
  settings: { countryCode?: string | null; countryId?: string | null; country?: string | null } | null,
): Promise<string> {
  if (!settings) return '';
  const fromCode = ossNormIso2(settings.countryCode);
  if (fromCode) return fromCode;
  if (settings.countryId) {
    const c = await client.country.findUnique({ where: { id: settings.countryId }, select: { iso2: true } });
    const fromFk = ossNormIso2(c?.iso2);
    if (fromFk) return fromFk;
  }
  return ossNormIso2(settings.country);
}

/**
 * Resolve an invoice's customer destination country + VAT validity (sync, using
 * a pre-resolved `iso2ById` for the legacy countryId fallback). Prefers the
 * billing contact when it carries a VAT number, else the primary contact —
 * identical contact-choice rule to the EC Sales List builder.
 */
export function resolveOssDestination(
  inv: OssInvoice,
  iso2ById: Map<string, string>,
): { customerCountry: string; customerVatValid: boolean } {
  const billTo = inv.billToContact;
  const billToVat = (billTo?.vatNumber || billTo?.vatRegNumber || '').trim();
  const c = billToVat ? billTo : inv.contact;
  const rawVat = (c?.vatNumber || c?.vatRegNumber || '').trim();
  const customerCountry =
    ossNormIso2(c?.country) || (c?.countryId ? iso2ById.get(c.countryId) ?? '' : '');
  const customerVatValid = rawVat ? parseVatNumber(rawVat).valid : false;
  return { customerCountry, customerVatValid };
}

export interface OssThreshold {
  /** YTD net (ex-VAT) of B2C cross-border EU sales for the calendar year. */
  ytdB2cCrossBorder: Prisma.Decimal;
  /** The fixed €10,000 threshold. */
  threshold: number;
  /** True once YTD exceeds the threshold. */
  exceeded: boolean;
  /** The calendar year evaluated. */
  year: number;
}

/** The prisma slice loadOssThreshold consumes — narrow so a stub satisfies it. */
export type OssThresholdPrisma = Pick<PrismaClient, 'companySettings' | 'invoice' | 'country'>;

/**
 * Sum the tenant's YTD B2C cross-border EU sales (net, ex-VAT) for `year` and
 * compare to the €10,000 distance-selling threshold. Tenant-scoped; Decimal-safe.
 *
 * Reuses the same supplier/customer resolution + isOssQualifyingSale classifier
 * as the OSS return so the threshold and the return always agree.
 */
export async function loadOssThreshold(
  userId: string,
  year: number,
  client: OssThresholdPrisma = defaultPrisma,
): Promise<OssThreshold> {
  const settings = await client.companySettings.findUnique({
    where: { userId },
    select: { countryCode: true, countryId: true, country: true },
  });
  const supplierCountry = await resolveOssSupplierCountry(client, settings);

  const from = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const invoices = (await client.invoice.findMany({
    where: { userId, isDeleted: false, invoiceDate: { gte: from, lte: to } },
    select: {
      taxableAmount: true,
      reverseCharge: true,
      contact: { select: { vatNumber: true, vatRegNumber: true, country: true, countryId: true } },
      billToContact: { select: { vatNumber: true, vatRegNumber: true, country: true, countryId: true } },
    },
  })) as OssInvoice[];

  const iso2ById = await loadIso2ById(client, invoices);

  let ytd = D0();
  for (const inv of invoices) {
    const dest = resolveOssDestination(inv, iso2ById);
    if (
      isOssQualifyingSale({
        supplierCountry,
        customerCountry: dest.customerCountry,
        reverseCharge: inv.reverseCharge === true,
        customerVatValid: dest.customerVatValid,
      })
    ) {
      ytd = ytd.plus(new Prisma.Decimal(inv.taxableAmount ?? 0));
    }
  }

  return {
    ytdB2cCrossBorder: ytd,
    threshold: OSS_THRESHOLD_EUR,
    exceeded: ytd.greaterThan(OSS_THRESHOLD_EUR),
    year,
  };
}

/**
 * Batch-resolve the legacy `countryId` → Country.iso2 fallback for any contact
 * (primary or billing) that lacks a modern ISO-2 `country`. One query, deduped.
 * Shared by loadOssThreshold and the controller's OSS-return loader.
 */
export async function loadIso2ById(
  client: Pick<PrismaClient, 'country'>,
  invoices: OssInvoice[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      invoices
        .flatMap((i) => [i.contact, i.billToContact])
        .filter((c): c is OssContact => !!c && !c.country && !!c.countryId)
        .map((c) => c.countryId as string),
    ),
  ];
  const iso2ById = new Map<string, string>();
  if (ids.length > 0) {
    const countries = await client.country.findMany({
      where: { id: { in: ids } },
      select: { id: true, iso2: true },
    });
    for (const co of countries) {
      if (co.iso2) iso2ById.set(co.id, co.iso2.toUpperCase());
    }
  }
  return iso2ById;
}
