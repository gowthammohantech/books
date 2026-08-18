// lib/moneyFlow/explanationHints.spec.ts
//
// TDD suite for the ExplanationHint learning-store helpers.
// Uses a mocked Prisma tx client (stub of explanationHint.upsert /
// explanationHint.findUnique) — no live DB needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalisePayeeKey, recordHint, lookupHint } from './explanationHints';

// ---------------------------------------------------------------------------
// Shared mock tx factory
// ---------------------------------------------------------------------------

function makeTx(overrides?: {
  upsert?: ReturnType<typeof vi.fn>;
  findUnique?: ReturnType<typeof vi.fn>;
}) {
  return {
    explanationHint: {
      upsert: overrides?.upsert ?? vi.fn().mockResolvedValue(undefined),
      findUnique: overrides?.findUnique ?? vi.fn().mockResolvedValue(null),
    },
  };
}

// ---------------------------------------------------------------------------
// normalisePayeeKey
// ---------------------------------------------------------------------------

describe('normalisePayeeKey', () => {
  it('lowercases and trims', () => {
    expect(normalisePayeeKey('  AMAZON  ')).toBe('amazon');
  });

  it('strips leading/trailing punctuation', () => {
    expect(normalisePayeeKey('!! Amazon !!')).toBe('amazon');
  });

  it('strips internal punctuation', () => {
    expect(normalisePayeeKey('Amazon.com, Inc.')).toBe('amazoncom inc');
  });

  it('collapses multiple internal spaces to one', () => {
    expect(normalisePayeeKey('Acme   Corp')).toBe('acme corp');
  });

  it('handles mixed punctuation + whitespace', () => {
    expect(normalisePayeeKey('  BP   Fuel  --  London  ')).toBe('bp fuel london');
  });

  it('returns empty string for null', () => {
    expect(normalisePayeeKey(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalisePayeeKey(undefined)).toBe('');
  });

  it('returns empty string for blank string', () => {
    expect(normalisePayeeKey('   ')).toBe('');
  });

  it('returns empty string for punctuation-only string', () => {
    expect(normalisePayeeKey('...')).toBe('');
  });

  it('handles alphanumeric payees with numbers', () => {
    expect(normalisePayeeKey('Shell 7-Eleven #42')).toBe('shell 7eleven 42');
  });
});

// ---------------------------------------------------------------------------
// recordHint
// ---------------------------------------------------------------------------

describe('recordHint', () => {
  it('is a no-op when payee normalises to empty string', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: '   ',
      transactionTypeKey: 'EXPENSE',
    });
    expect(tx.explanationHint.upsert).not.toHaveBeenCalled();
  });

  it('is a no-op when payee is null', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: null,
      transactionTypeKey: 'EXPENSE',
    });
    expect(tx.explanationHint.upsert).not.toHaveBeenCalled();
  });

  it('calls upsert with the normalised payeeKey', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: '  Amazon.com  ',
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-1',
    });
    expect(tx.explanationHint.upsert).toHaveBeenCalledOnce();
    const call = tx.explanationHint.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId_payeeKey: { userId: 'u1', payeeKey: 'amazoncom' } });
  });

  it('sets hitCount to 1 and records correct fields on insert', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: 'Shell',
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-fuel',
      payToUserId: null,
    });
    const call = tx.explanationHint.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      userId: 'u1',
      payeeKey: 'shell',
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-fuel',
      payToUserId: null,
      hitCount: 1,
    });
    expect(call.create.lastUsedAt).toBeInstanceOf(Date);
  });

  it('increments hitCount and bumps lastUsedAt on conflict', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: 'Shell',
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-fuel',
    });
    const call = tx.explanationHint.upsert.mock.calls[0][0];
    // The update clause must increment hitCount
    expect(call.update).toMatchObject({
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-fuel',
    });
    // hitCount increment expressed as { increment: 1 }
    expect(call.update.hitCount).toEqual({ increment: 1 });
    expect(call.update.lastUsedAt).toBeInstanceOf(Date);
  });

  it('passes payToUserId correctly', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: 'Owner',
      transactionTypeKey: 'OWNER_IN',
      payToUserId: 'user-99',
    });
    const call = tx.explanationHint.upsert.mock.calls[0][0];
    expect(call.create.payToUserId).toBe('user-99');
    expect(call.update.payToUserId).toBe('user-99');
  });

  it('defaults missing categoryId and payToUserId to null', async () => {
    const tx = makeTx();
    await recordHint(tx as any, {
      userId: 'u1',
      payee: 'Tesco',
      transactionTypeKey: 'EXPENSE',
    });
    const call = tx.explanationHint.upsert.mock.calls[0][0];
    expect(call.create.categoryId).toBeNull();
    expect(call.create.payToUserId).toBeNull();
    expect(call.update.categoryId).toBeNull();
    expect(call.update.payToUserId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lookupHint
// ---------------------------------------------------------------------------

describe('lookupHint', () => {
  it('returns null when payee normalises to empty string', async () => {
    const tx = makeTx();
    const result = await lookupHint(tx as any, 'u1', '   ');
    expect(result).toBeNull();
    expect(tx.explanationHint.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when payee is null', async () => {
    const tx = makeTx();
    const result = await lookupHint(tx as any, 'u1', null);
    expect(result).toBeNull();
  });

  it('returns null when no hint found in DB', async () => {
    const tx = makeTx({ findUnique: vi.fn().mockResolvedValue(null) });
    const result = await lookupHint(tx as any, 'u1', 'Amazon');
    expect(result).toBeNull();
  });

  it('calls findUnique with normalised payeeKey', async () => {
    const tx = makeTx({ findUnique: vi.fn().mockResolvedValue(null) });
    await lookupHint(tx as any, 'u1', '  AMAZON  ');
    expect(tx.explanationHint.findUnique).toHaveBeenCalledWith({
      where: { userId_payeeKey: { userId: 'u1', payeeKey: 'amazon' } },
    });
  });

  it('returns the mapping fields when a hint is found', async () => {
    const stored = {
      id: 'h-1',
      userId: 'u1',
      payeeKey: 'amazon',
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-1',
      payToUserId: null,
      hitCount: 3,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = makeTx({ findUnique: vi.fn().mockResolvedValue(stored) });
    const result = await lookupHint(tx as any, 'u1', 'amazon');
    expect(result).toEqual({
      transactionTypeKey: 'EXPENSE',
      categoryId: 'cat-1',
      payToUserId: null,
    });
  });

  it('returns payToUserId when set', async () => {
    const stored = {
      id: 'h-2',
      userId: 'u1',
      payeeKey: 'owner',
      transactionTypeKey: 'OWNER_IN',
      categoryId: null,
      payToUserId: 'user-99',
      hitCount: 1,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = makeTx({ findUnique: vi.fn().mockResolvedValue(stored) });
    const result = await lookupHint(tx as any, 'u1', 'Owner');
    expect(result).toEqual({
      transactionTypeKey: 'OWNER_IN',
      categoryId: null,
      payToUserId: 'user-99',
    });
  });
});
