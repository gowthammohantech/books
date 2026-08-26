import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    customField: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    fieldType: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma';
import { createCustomField, updateCustomField } from './customFieldController';

function fakeRes() {
  const res: Record<string, any> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const baseBody = {
  moduleId: 'm1',
  labelName: 'HSN Code',
  fieldSlug: 'hsn_code',
};

beforeEach(() => {
  vi.mocked(prisma.customField.findFirst).mockReset().mockResolvedValue(null as any);
  vi.mocked(prisma.customField.findUnique).mockReset();
  vi.mocked(prisma.customField.create).mockReset().mockResolvedValue({ id: 'cf1' } as any);
  vi.mocked(prisma.customField.update).mockReset().mockResolvedValue({ id: 'cf1' } as any);
  vi.mocked(prisma.fieldType.findUnique).mockReset();
});

describe('createCustomField dataType guard', () => {
  it('400s when dataType is missing', async () => {
    const res = fakeRes();
    await createCustomField({ body: { ...baseBody } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Data type is required' }),
    );
    expect(prisma.customField.create).not.toHaveBeenCalled();
  });

  it('400s when dataType references no FieldType', async () => {
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue(null as any);
    const res = fakeRes();
    await createCustomField({ body: { ...baseBody, dataType: 'nope' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid data type' }),
    );
    expect(prisma.customField.create).not.toHaveBeenCalled();
  });

  it('still 400s file + lineItem', async () => {
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue({ id: 'ft1', slug: 'file' } as any);
    const res = fakeRes();
    await createCustomField(
      { body: { ...baseBody, dataType: 'ft1', placement: 'lineItem' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'File fields cannot be placed on line items' }),
    );
  });

  it('creates with a valid dataType', async () => {
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue({ id: 'ft1', slug: 'text' } as any);
    const res = fakeRes();
    await createCustomField({ body: { ...baseBody, dataType: 'ft1' } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(prisma.customField.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fieldTypeId: 'ft1' }) }),
    );
  });
});

describe('updateCustomField dataType guard', () => {
  const storedField = {
    id: 'cf1',
    moduleId: 'm1',
    labelName: 'HSN Code',
    fieldSlug: 'hsn_code',
    fieldTypeId: 'ft1',
    helpText: '',
    isMandatory: false,
    showInTable: false,
    status: 'Active',
    placement: 'document',
  };

  it('400s when a provided dataType references no FieldType', async () => {
    vi.mocked(prisma.customField.findUnique).mockResolvedValue(storedField as any);
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue(null as any);
    const res = fakeRes();
    await updateCustomField(
      { params: { id: 'cf1' }, body: { dataType: 'nope' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Invalid data type' }),
    );
    expect(prisma.customField.update).not.toHaveBeenCalled();
  });

  it('updates fine when dataType is omitted (falls back to stored fieldTypeId)', async () => {
    vi.mocked(prisma.customField.findUnique).mockResolvedValue(storedField as any);
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue({ id: 'ft1', slug: 'text' } as any);
    const res = fakeRes();
    await updateCustomField(
      { params: { id: 'cf1' }, body: { labelName: 'HSN' } } as any,
      res as any,
    );
    expect(prisma.customField.update).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('still 400s when effective type becomes file on lineItem placement', async () => {
    vi.mocked(prisma.customField.findUnique).mockResolvedValue(
      { ...storedField, placement: 'lineItem' } as any,
    );
    vi.mocked(prisma.fieldType.findUnique).mockResolvedValue({ id: 'ft2', slug: 'file' } as any);
    const res = fakeRes();
    await updateCustomField(
      { params: { id: 'cf1' }, body: { dataType: 'ft2' } } as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'File fields cannot be placed on line items' }),
    );
  });
});
