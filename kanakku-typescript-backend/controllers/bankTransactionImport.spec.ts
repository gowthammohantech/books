// controllers/bankTransactionImport.spec.ts
//
// Bank-statement CSV import should capture a reference/cheque-number column
// (when present, under any of several tolerant header aliases) and thread it
// through preview -> confirm so BankTransaction.referenceNo is populated
// instead of hardcoded ''. A populated referenceNo materially improves the
// auto-matcher's reference-based scoring (lib/reconciliationMatcher.ts,
// lib/moneyFlow/autoMatch.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const bankDetailFindFirst = vi.fn(async (_args?: unknown) => ({
  id: 'acct-1',
  userId: 'tenant-1',
  isDeleted: false,
  currentBalance: 0,
}));
const bankDetailUpdate = vi.fn(async (_args?: unknown) => ({}));
const paymentModeFindUnique = vi.fn(async (_args?: unknown) => ({
  id: 'pm-1',
  name: 'Other',
  slug: 'other',
}));
const paymentModeCreate = vi.fn(async (_args?: unknown) => ({
  id: 'pm-1',
  name: 'Other',
  slug: 'other',
}));
const bankTransactionCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: 'txn-1',
  ...args.data,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    bankDetail: {
      findFirst: (args: unknown) => bankDetailFindFirst(args),
      update: (args: unknown) => bankDetailUpdate(args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        paymentMode: {
          findUnique: (args: unknown) => paymentModeFindUnique(args),
          create: (args: unknown) => paymentModeCreate(args),
        },
        bankTransaction: {
          create: (args: { data: Record<string, unknown> }) => bankTransactionCreate(args),
        },
        bankDetail: {
          update: (args: unknown) => bankDetailUpdate(args),
        },
      }),
  },
}));

vi.mock('../lib/moneyFlow/applyProposal', () => ({
  applyAutoMatch: vi.fn(async () => undefined),
}));

import { importPreview, importConfirm } from './bankTransactionController';

function fakeReq(
  body: unknown = {},
  file?: { buffer: Buffer },
): Request {
  return {
    body,
    file,
    tenantId: 'tenant-1',
    user: 'tenant-1',
  } as unknown as Request;
}
function fakeRes(): Response & { body: any; statusCode: number } {
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { body: any; statusCode: number };
}

beforeEach(() => {
  bankDetailFindFirst.mockClear();
  bankDetailUpdate.mockClear();
  paymentModeFindUnique.mockClear();
  paymentModeCreate.mockClear();
  bankTransactionCreate.mockClear();
});

describe('importPreview — reference/cheque column capture', () => {
  it('captures a "reference" column into the preview row', async () => {
    const csv = 'date,description,amount,type,reference\n2026-01-01,Test,100,DEPOSIT,REF123\n';
    const res = fakeRes();
    await importPreview(fakeReq({}, { buffer: Buffer.from(csv) }), res);

    expect(res.statusCode).toBe(200);
    const row = res.body.data.previewRows[0];
    expect(row.reference).toBe('REF123');
  });

  it('captures a "cheque_no" column into the preview row', async () => {
    const csv = 'date,description,amount,type,cheque_no\n2026-01-01,Test,100,DEPOSIT, CHQ-99 \n';
    const res = fakeRes();
    await importPreview(fakeReq({}, { buffer: Buffer.from(csv) }), res);

    expect(res.statusCode).toBe(200);
    const row = res.body.data.previewRows[0];
    expect(row.reference).toBe('CHQ-99');
  });

  it('defaults reference to empty string when no reference-like column is present', async () => {
    const csv = 'date,description,amount,type\n2026-01-01,Test,100,DEPOSIT\n';
    const res = fakeRes();
    await importPreview(fakeReq({}, { buffer: Buffer.from(csv) }), res);

    expect(res.statusCode).toBe(200);
    const row = res.body.data.previewRows[0];
    expect(row.reference).toBe('');
  });
});

describe('importConfirm — referenceNo persisted from preview row', () => {
  it('writes the parsed reference into BankTransaction.referenceNo', async () => {
    const res = fakeRes();
    await importConfirm(
      fakeReq({
        bankAccountId: 'acct-1',
        rows: [
          {
            date: '2026-01-01',
            description: 'Test',
            amount: 100,
            type: 'DEPOSIT',
            reference: 'REF123',
          },
        ],
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(bankTransactionCreate).toHaveBeenCalledTimes(1);
    const data = bankTransactionCreate.mock.calls[0][0].data;
    expect(data.referenceNo).toBe('REF123');
  });

  it('falls back to empty string referenceNo when the row carries no reference', async () => {
    const res = fakeRes();
    await importConfirm(
      fakeReq({
        bankAccountId: 'acct-1',
        rows: [
          {
            date: '2026-01-01',
            description: 'Test',
            amount: 100,
            type: 'DEPOSIT',
          },
        ],
      }),
      res,
    );

    expect(res.statusCode).toBe(201);
    const data = bankTransactionCreate.mock.calls[0][0].data;
    expect(data.referenceNo).toBe('');
  });
});
