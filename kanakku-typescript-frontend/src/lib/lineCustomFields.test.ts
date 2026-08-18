import { describe, it, expect } from 'vitest';
import {
    collectLineCustomColumns, excludeLineItemFields, formatLineFieldDate, formatLineFieldValue,
    humanizeSlug, mergeLineFieldAutofill, pickMatchingLineFieldValues,
    validateLineCustomFields,
    type LineCustomField,
} from './lineCustomFields';

const hsn: LineCustomField = { id: 'f1', labelName: 'HSN Code', fieldSlug: 'hsn_code', isMandatory: true };
const batch: LineCustomField = { id: 'f2', labelName: 'Batch', fieldSlug: 'batch_no', isMandatory: false };

describe('humanizeSlug', () => {
    it('title-cases slug words', () => {
        expect(humanizeSlug('hsn_code')).toBe('Hsn Code');
        expect(humanizeSlug('mfr-part-number')).toBe('Mfr Part Number');
    });
});

describe('collectLineCustomColumns', () => {
    it('returns columns for slugs with any non-empty value, labelled from defs else humanized', () => {
        const items = [
            { customFields: { hsn_code: '8471', empty: '', blank: '   ', none: null } },
            { customFields: { serial_no: 'SN-1' } },
            {},
        ];
        expect(collectLineCustomColumns(items, [hsn])).toEqual([
            { slug: 'hsn_code', label: 'HSN Code', field: hsn },
            { slug: 'serial_no', label: 'Serial No', field: undefined },
        ]);
        expect(collectLineCustomColumns(undefined, [hsn])).toEqual([]);
    });

    it('orders defined columns by field-definition order, orphans after in encounter order', () => {
        const items = [
            { customFields: { orphan_b: 'x', batch_no: 'B-1' } },
            { customFields: { orphan_a: 'y', hsn_code: '8471' } },
        ];
        expect(collectLineCustomColumns(items, [hsn, batch]).map((c) => c.slug)).toEqual([
            'hsn_code', 'batch_no', 'orphan_b', 'orphan_a',
        ]);
    });

    it('emits no column for a defined field with only blank values', () => {
        const items = [{ customFields: { hsn_code: '   ' } }];
        expect(collectLineCustomColumns(items, [hsn])).toEqual([]);
    });
});

describe('pickMatchingLineFieldValues', () => {
    it('copies only defined-slug scalar/array values', () => {
        expect(pickMatchingLineFieldValues(
            { hsn_code: '8471', batch_no: null, other: 'x', arr: ['a'] },
            [hsn, batch],
        )).toEqual({ hsn_code: '8471' });
    });
});

describe('excludeLineItemFields', () => {
    it('drops lineItem-placed fields, keeps document and unplaced', () => {
        expect(excludeLineItemFields([
            { placement: 'lineItem' }, { placement: 'document' }, {},
        ])).toEqual([{ placement: 'document' }, {}]);
    });
});

describe('validateLineCustomFields', () => {
    it('flags missing mandatory values on named rows only', () => {
        expect(validateLineCustomFields(
            [{ name: 'Pen', customFields: {} }, { name: '', customFields: {} }],
            [hsn],
        )).toBe('HSN Code is required for item "Pen".');
        expect(validateLineCustomFields(
            [{ name: 'Pen', customFields: { hsn_code: '8471' } }],
            [hsn],
        )).toBeNull();
        expect(validateLineCustomFields([{ name: 'Pen' }], [batch])).toBeNull();
    });
});

describe('validateLineCustomFields grandfathering', () => {
    const oldDoc = '2026-01-01T00:00:00.000Z';
    const newField: LineCustomField = {
        id: 'f5', labelName: 'HSN Code', fieldSlug: 'hsn_code', isMandatory: true,
        createdAt: '2026-07-17T00:00:00.000Z',
    };
    const items = [{ name: 'Pen', customFields: {} }];

    it('skips mandatory fields created after the document', () => {
        expect(validateLineCustomFields(items, [newField], oldDoc)).toBeNull();
    });

    it('enforces when the document is newer than the field', () => {
        expect(validateLineCustomFields(items, [newField], '2026-07-18T00:00:00.000Z'))
            .toBe('HSN Code is required for item "Pen".');
    });

    it('enforces strictly without docCreatedAt or without field createdAt', () => {
        expect(validateLineCustomFields(items, [newField]))
            .toBe('HSN Code is required for item "Pen".');
        const noStamp: LineCustomField = { ...newField, createdAt: undefined };
        expect(validateLineCustomFields(items, [noStamp], oldDoc))
            .toBe('HSN Code is required for item "Pen".');
    });

    it('enforces strictly on unparseable timestamps', () => {
        expect(validateLineCustomFields(items, [newField], 'not-a-date'))
            .toBe('HSN Code is required for item "Pen".');
        const badStamp: LineCustomField = { ...newField, createdAt: 'garbage' };
        expect(validateLineCustomFields(items, [badStamp], oldDoc))
            .toBe('HSN Code is required for item "Pen".');
    });
});

describe('formatLineFieldDate', () => {
    it('formats ISO dates and passes through everything else', () => {
        expect(formatLineFieldDate('2026-07-17')).toBe('17 Jul 2026');
        expect(formatLineFieldDate('2026-01-05')).toBe('5 Jan 2026');
        expect(formatLineFieldDate('17/07/2026')).toBe('17/07/2026');
        expect(formatLineFieldDate('2026-13-05')).toBe('2026-13-05');
        expect(formatLineFieldDate('')).toBe('');
    });
});

describe('formatLineFieldValue', () => {
    const grade: LineCustomField = {
        id: 'f3', labelName: 'Grade', fieldSlug: 'grade', isMandatory: false,
        dataType: { id: 't1', name: 'Dropdown', slug: 'dropdown' },
        options: [{ label: 'Grade A', value: 'a' }, { label: 'Grade B', value: 'b' }],
    };
    const expiry: LineCustomField = {
        id: 'f4', labelName: 'Expiry', fieldSlug: 'expiry', isMandatory: false,
        dataType: { id: 't2', name: 'Date', slug: 'datepicker' },
    };

    it('renders blanks as dash', () => {
        expect(formatLineFieldValue(undefined)).toBe('-');
        expect(formatLineFieldValue(null)).toBe('-');
        expect(formatLineFieldValue('   ')).toBe('-');
        expect(formatLineFieldValue([])).toBe('-');
    });

    it('maps stored option values to labels for dropdown/radio', () => {
        expect(formatLineFieldValue('a', grade)).toBe('Grade A');
        expect(formatLineFieldValue('unknown', grade)).toBe('unknown');
    });

    it('formats datepicker ISO values', () => {
        expect(formatLineFieldValue('2026-07-17', expiry)).toBe('17 Jul 2026');
    });

    it('joins arrays with option mapping, stringifies scalars without a field', () => {
        expect(formatLineFieldValue(['a', 'b'], grade)).toBe('Grade A, Grade B');
        expect(formatLineFieldValue(8471)).toBe('8471');
        expect(formatLineFieldValue('raw')).toBe('raw');
    });
});

describe('mergeLineFieldAutofill', () => {
    it('fills from product values, existing row values win, empty stays {}', () => {
        expect(mergeLineFieldAutofill(
            { hsn_code: '8471', batch_no: 'B-9' },
            { batch_no: 'B-1' },
            [hsn, batch],
        )).toEqual({ hsn_code: '8471', batch_no: 'B-1' });
        expect(mergeLineFieldAutofill({ other: 'x' }, undefined, [hsn])).toEqual({});
        expect(mergeLineFieldAutofill(undefined, { hsn_code: 'manual' }, [hsn])).toEqual({ hsn_code: 'manual' });
    });
});
