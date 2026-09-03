/**
 * Quotation service unit tests.
 *
 * Note what is NOT here: `vi.mock('../../lib/prisma')`. These are the rules the
 * controller kept behind a `Request` — the list filter, the numbering series,
 * the presenters — and reaching them used to mean building a fake req/res pair
 * and a mocked Prisma delegate. They are now plain functions over plain values.
 */
import { describe, expect, it } from 'vitest';

import {
  buildListWhere,
  deriveNextQuotationId,
  formatDateLong,
  formatDateShort,
  presentItems,
  presentListBank,
  presentDetailBank,
  presentListParty,
  presentSignature,
  TRANSITIONABLE_STATUSES,
} from './quotation.service';

const SCOPE = { tenantId: 't1', isDeleted: false };

describe('buildListWhere', () => {
  it('always carries the tenant scope through', () => {
    expect(buildListWhere(SCOPE, {})).toEqual(SCOPE);
  });

  it('accepts a known status and ignores an unknown one', () => {
    expect(buildListWhere(SCOPE, { status: 'sent' }).status).toBe('sent');
    // A bogus status must not become a filter — it would return an empty list
    // where the caller meant "no status filter".
    expect(buildListWhere(SCOPE, { status: 'banana' }).status).toBeUndefined();
  });

  it('builds a half-open date range from either bound alone', () => {
    const from = buildListWhere(SCOPE, { startDate: '2026-01-01' }).quotationDate;
    expect(from).toEqual({ gte: new Date('2026-01-01') });
    const to = buildListWhere(SCOPE, { endDate: '2026-02-01' }).quotationDate;
    expect(to).toEqual({ lte: new Date('2026-02-01') });
  });

  it('searches number, reference, notes and the legacy customer name', () => {
    const or = buildListWhere(SCOPE, { search: 'acme' }).OR;
    expect(or).toHaveLength(4);
    // Documented gap: contact-linked documents — the current write path — are
    // not searchable by party name here, only legacy customer-linked ones.
    expect(JSON.stringify(or)).not.toContain('contact');
  });
});

describe('deriveNextQuotationId', () => {
  it('increments the numeric tail and keeps the tenant prefix', () => {
    expect(deriveNextQuotationId('QT-000041')).toBe('QT-000042');
    expect(deriveNextQuotationId('ACME-QT-000009')).toBe('ACME-QT-000010');
  });

  it('pads to six digits, widening past them rather than truncating', () => {
    expect(deriveNextQuotationId('QT-9')).toBe('QT-000010');
    expect(deriveNextQuotationId('QT-9999999')).toBe('QT-10000000');
  });

  it('falls back when there is no previous number, or none to parse', () => {
    expect(deriveNextQuotationId(null)).toBe('QT-000001');
    expect(deriveNextQuotationId('DRAFT')).toBe('QT-000001');
  });
});

describe('TRANSITIONABLE_STATUSES', () => {
  it('is the accept/decline pair, not the full status set', () => {
    expect([...TRANSITIONABLE_STATUSES].sort()).toEqual(['accepted', 'declined']);
    // `sent` is reachable only through the email handler, and `draft` only at
    // creation; PATCH /quotations-status must reject both.
    expect(TRANSITIONABLE_STATUSES.has('sent')).toBe(false);
    expect(TRANSITIONABLE_STATUSES.has('draft')).toBe(false);
  });
});

describe('date formatting', () => {
  const d = new Date(2026, 0, 9); // local time: these formatters read local parts

  it('uses dd/mm/yyyy for the detail read and dd, Mon yyyy for the list', () => {
    expect(formatDateLong(d)).toBe('09/01/2026');
    expect(formatDateShort(d)).toBe('09, Jan 2026');
  });

  it('passes null through rather than rendering an epoch', () => {
    expect(formatDateLong(null)).toBeNull();
    expect(formatDateShort(undefined)).toBeNull();
  });
});

describe('presentItems', () => {
  it('reads the current field names', () => {
    expect(presentItems([{ id: 'p1', name: 'Widget', qty: 2, rate: 100, amount: 200 }])).toEqual([
      {
        id: 'p1', productId: 'p1', name: 'Widget', unit: '', qty: 2, rate: 100,
        discount: 0, tax: 0, tax_group_id: null, discount_type: 'Fixed',
        discount_value: 0, amount: 200,
      },
    ]);
  });

  it('reads the older field names still on rows in production', () => {
    const [item] = presentItems([
      { productId: 'p9', productName: 'Legacy', totalTax: 18, lineTotal: 118 },
    ]);
    expect(item).toMatchObject({ id: 'p9', productId: 'p9', name: 'Legacy', tax: 18, amount: 118 });
  });

  it('returns [] for a non-array items column', () => {
    // The column is JSON and nullable; older rows hold null, and one bad row
    // must not 500 the whole list.
    expect(presentItems(null)).toEqual([]);
    expect(presentItems({ not: 'an array' })).toEqual([]);
  });
});

describe('presenters that deliberately differ between list and detail', () => {
  const bank = {
    id: 'b1', accountHoldername: 'A', bankName: 'B',
    branchName: 'C', accountNumber: 'D', IFSCCode: 'E',
  };

  it('omits the bank id in the list and includes it in the detail', () => {
    expect(presentListBank(bank)).not.toHaveProperty('id');
    expect(presentDetailBank(bank)).toHaveProperty('id', 'b1');
  });

  it('prefers the contact over the legacy customer', () => {
    const party = presentListParty(
      { id: 'c1', firstName: 'Ada', lastName: 'Lovelace', organisation: null, email: 'a@x.test', mobile: '1' },
      { id: 'cu1', name: 'Legacy Co', email: 'l@x.test', phone: '2', image: 'up/x.png' },
      'http://h/',
    );
    expect(party).toMatchObject({ id: 'c1', name: 'Ada Lovelace' });
  });

  it('falls back to the customer, turning a Windows path into a URL', () => {
    const party = presentListParty(
      null,
      { id: 'cu1', name: 'Legacy Co', email: 'l@x.test', phone: '2', image: 'uploads\\x.png' },
      'http://h/',
    );
    expect(party).toMatchObject({ id: 'cu1', image: 'http://h/uploads/x.png' });
  });

  it('is null when neither party is set', () => {
    expect(presentListParty(null, null, 'http://h/')).toBeNull();
  });
});

describe('presentSignature', () => {
  const stored = { id: 's1', signatureName: 'Stored', signatureImage: 'sig/s.png' };

  it('reads an eSignature off the document, not the Signature table', () => {
    expect(presentSignature('eSignature', 'Drawn', 'up/d.png', stored, 'http://h/', true))
      .toEqual({ name: 'Drawn', image: 'http://h/up/d.png' });
  });

  it('emits id+name only for the list, id+name+image for the detail', () => {
    expect(presentSignature('digitalSignature', null, null, stored, 'http://h/', false))
      .toEqual({ id: 's1', name: 'Stored' });
    expect(presentSignature('digitalSignature', null, null, stored, 'http://h/', true))
      .toEqual({ id: 's1', name: 'Stored', image: 'http://h/sig/s.png' });
  });

  it('is null when sign_type is none and nothing is stored', () => {
    expect(presentSignature('none', null, null, null, 'http://h/', true)).toBeNull();
  });
});
