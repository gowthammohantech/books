import { describe, it, expect, vi } from 'vitest';
import { CustomFieldValueModule } from '@prisma/client';
import { insertCustomFieldValues, readCustomFieldValuesForRecords } from './customFieldValues';

function fakeTx() {
  const calls: any = { deleted: null, created: null };
  return {
    calls,
    customFieldValue: {
      deleteMany: vi.fn(async (a: any) => { calls.deleted = a; }),
      createMany: vi.fn(async (a: any) => { calls.created = a; }),
    },
  };
}

describe('insertCustomFieldValues', () => {
  it('maps fieldId->customFieldId, sets module/recordId/value, deletes first', async () => {
    const tx = fakeTx();
    await insertCustomFieldValues(tx as any, {
      module: CustomFieldValueModule.product, recordId: 'p1', userId: 'u1', files: [],
      customFields: [{ fieldId: 'cf1', value: 'red' }, { fieldId: 'cf2', value: '5' }],
    });
    expect(tx.calls.deleted).toEqual({ where: { module: CustomFieldValueModule.product, recordId: 'p1' } });
    expect(tx.calls.created.data).toEqual([
      { customFieldId: 'cf1', module: CustomFieldValueModule.product, recordId: 'p1', value: 'red', createdBy: 'u1' },
      { customFieldId: 'cf2', module: CustomFieldValueModule.product, recordId: 'p1', value: '5', createdBy: 'u1' },
    ]);
  });

  it('accepts a JSON string for customFields', async () => {
    const tx = fakeTx();
    await insertCustomFieldValues(tx as any, {
      module: CustomFieldValueModule.brand, recordId: 'b1', userId: 'u1', files: [],
      customFields: JSON.stringify([{ fieldId: 'cf9', value: 'x' }]),
    });
    expect(tx.calls.created.data[0]).toMatchObject({ customFieldId: 'cf9', module: CustomFieldValueModule.brand, recordId: 'b1', value: 'x' });
  });

  it('uses file path for file-type field (customField_<fieldId>)', async () => {
    const tx = fakeTx();
    await insertCustomFieldValues(tx as any, {
      module: CustomFieldValueModule.unit, recordId: 'u9', userId: 'u1',
      files: [{ fieldname: 'customField_cf3', path: 'uploads/x.png' } as any],
      customFields: [{ fieldId: 'cf3', value: '' }],
    });
    expect(tx.calls.created.data[0].value).toBe('uploads/x.png');
  });

  it('no-ops cleanly on empty customFields', async () => {
    const tx = fakeTx();
    await insertCustomFieldValues(tx as any, { module: CustomFieldValueModule.product, recordId: 'p2', userId: 'u1', files: [], customFields: [] });
    // delete still runs (clears prior), createMany skipped or empty
    expect(tx.calls.deleted).toBeTruthy();
    expect(tx.customFieldValue.createMany).not.toHaveBeenCalled();
  });

  it('malformed JSON string throws and does NOT call deleteMany', async () => {
    const tx = fakeTx();
    await expect(
      insertCustomFieldValues(tx as any, {
        module: CustomFieldValueModule.product, recordId: 'p3', userId: 'u1', files: [],
        customFields: '{not valid json',
      }),
    ).rejects.toThrow('Invalid customFields payload');
    expect(tx.customFieldValue.deleteMany).not.toHaveBeenCalled();
  });
});

describe('readCustomFieldValuesForRecords', () => {
  it('maps values per record keyed by fieldSlug, null when missing', async () => {
    const prisma: any = {
      module: { findFirst: async () => ({ id: 'm1' }) },
      customField: { findMany: async () => [{ id: 'cf1', fieldSlug: 'hsn_code' }] },
      customFieldValue: {
        findMany: async () => [{ customFieldId: 'cf1', recordId: 'p1', value: '8471' }],
      },
    };
    const out = await readCustomFieldValuesForRecords(prisma, {
      module: CustomFieldValueModule.product, recordIds: ['p1', 'p2'], moduleSlug: 'product-services',
    });
    expect(out).toEqual({ p1: { hsn_code: '8471' }, p2: { hsn_code: null } });
  });

  it('returns {} for empty ids, unknown module, or no fields', async () => {
    const noMod: any = { module: { findFirst: async () => null } };
    expect(await readCustomFieldValuesForRecords(noMod, {
      module: CustomFieldValueModule.product, recordIds: ['p1'], moduleSlug: 'nope',
    })).toEqual({});
    expect(await readCustomFieldValuesForRecords({} as any, {
      module: CustomFieldValueModule.product, recordIds: [], moduleSlug: 'product-services',
    })).toEqual({});
  });

  it('restricts the value query to the module\'s live field ids', async () => {
    let captured: any = null;
    const prisma: any = {
      module: { findFirst: async () => ({ id: 'm1' }) },
      customField: { findMany: async () => [{ id: 'cf1', fieldSlug: 'hsn_code' }] },
      customFieldValue: {
        findMany: async (args: any) => {
          captured = args;
          return [];
        },
      },
    };
    await readCustomFieldValuesForRecords(prisma, {
      module: CustomFieldValueModule.product, recordIds: ['p1'], moduleSlug: 'product-services',
    });
    expect(captured.where).toEqual({
      module: CustomFieldValueModule.product,
      recordId: { in: ['p1'] },
      customFieldId: { in: ['cf1'] },
    });
  });
});
