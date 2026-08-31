/**
 * tests/tenant/integrity.test.ts
 *
 * The FK inventory that prisma/checkTenantIntegrity.ts walks.
 *
 * The check itself needs a database — it is `npm run prisma:check:tenant`, and
 * it is what closes limitations 2 and 3 in lib/tenantGuard.ts (unfiltered
 * relation reads, and `connect: { id }` naming a foreign row). What CAN be
 * tested without one is the part most likely to rot: the derivation of WHICH
 * foreign keys to check.
 *
 * That derivation is DMMF-driven rather than hand-listed, so a relation added
 * next year is covered the day it is added. These tests pin that it still finds
 * the relations it should, and still ignores the ones it should — because a
 * check that quietly stops looking at anything reports "OK" just as loudly as
 * one that genuinely passes.
 */
import { describe, it, expect } from 'vitest';

import { tenantForeignKeys, formatReport } from '../../prisma/checkTenantIntegrity';
import { TENANT_MODELS, GLOBAL_MODELS, EXPLICIT_MODELS } from '../../lib/tenantGuard';

const PAIRS = tenantForeignKeys();
const key = (p: { childModel: string; childColumn: string; parentModel: string }) =>
  `${p.childModel}.${p.childColumn} -> ${p.parentModel}`;
const KEYS = new Set(PAIRS.map(key));

describe('tenant foreign-key discovery', () => {
  it('finds a substantial inventory (the DMMF walk still works)', () => {
    expect(PAIRS.length).toBeGreaterThan(80);
  });

  it('covers the relations most likely to carry a cross-tenant row', () => {
    // Document line items and payments: the shapes a nested write or an
    // unvalidated `connect` would corrupt.
    expect(KEYS).toContain('InvoicePayment.invoiceId -> Invoice');
    expect(KEYS).toContain('SupplierPayment.purchaseId -> Purchase');
    expect(KEYS).toContain('JournalLine.journalEntryId -> JournalEntry');
    expect(KEYS).toContain('JournalLine.accountId -> Account');
    // Catalog references from documents — the P4 conversions.
    expect(KEYS).toContain('Product.brandId -> Brand');
    expect(KEYS).toContain('Product.categoryId -> Category');
    expect(KEYS).toContain('Product.unitId -> Unit');
    expect(KEYS).toContain('CustomFieldValue.customFieldId -> CustomField');
    // Per-tenant RBAC.
    expect(KEYS).toContain('Permission.roleId -> Role');
  });

  it('ignores foreign keys into platform reference data', () => {
    // A Product pointing at a global Country is not a tenancy question, and
    // checking it would be pure noise.
    for (const p of PAIRS) {
      expect(GLOBAL_MODELS.has(p.parentModel), key(p)).toBe(false);
      expect(GLOBAL_MODELS.has(p.childModel), key(p)).toBe(false);
    }
  });

  it('ignores foreign keys into the hand-scoped models', () => {
    // User has no tenantId to compare against — the join would be malformed.
    // Every `createdBy`/`approvedById` actor FK lands here, correctly.
    for (const p of PAIRS) {
      expect(EXPLICIT_MODELS.has(p.parentModel), key(p)).toBe(false);
      expect(EXPLICIT_MODELS.has(p.childModel), key(p)).toBe(false);
    }
  });

  it('only ever pairs two tenant-scoped models', () => {
    for (const p of PAIRS) {
      expect(TENANT_MODELS.has(p.childModel), key(p)).toBe(true);
      expect(TENANT_MODELS.has(p.parentModel), key(p)).toBe(true);
    }
  });

  it('produces one entry per foreign key, not one per relation side', () => {
    // Only the owning side carries relationFromFields, so back-relations must
    // not appear — a duplicate would double the work and the noise.
    expect(new Set(KEYS).size).toBe(PAIRS.length);
    // The back-relation of InvoicePayment.invoiceId would look like this:
    expect(KEYS).not.toContain('Invoice.payments -> InvoicePayment');
  });

  it('joins on a single column (composite keys would need a different join)', () => {
    for (const p of PAIRS) {
      expect(p.childColumn, key(p)).toBeTruthy();
      expect(p.parentColumn, key(p)).toBe('id');
    }
  });
});

describe('report formatting', () => {
  it('says so plainly when nothing is wrong', () => {
    expect(formatReport({ checked: 118, violations: [] })).toContain('OK');
  });

  it('names the relation, the count and a sample when something is', () => {
    const out = formatReport({
      checked: 118,
      violations: [{
        relation: 'Product.brandId -> Brand',
        childModel: 'Product',
        parentModel: 'Brand',
        count: 3,
        sampleIds: ['p-1', 'p-2'],
      }],
    });
    expect(out).toContain('1 VIOLATION(S)');
    expect(out).toContain('Product.brandId -> Brand: 3 row(s)');
    expect(out).toContain('p-1, p-2');
  });
});
