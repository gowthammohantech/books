import { describe, it, expect, vi } from 'vitest';

const gatedPost = vi.fn();
vi.mock('../ledger/ledgerPosting', () => ({ gatedPost: (...a: unknown[]) => gatedPost(...a) }));
vi.mock('../ledger/postingEngine', () => ({ reverse: vi.fn() }));

import { postPayRunLineAccrual } from './payRunPosting';

describe('postPayRunLineAccrual', () => {
  it('posts Dr wages(gross) / Cr net payable / Cr deductions payable', async () => {
    gatedPost.mockClear();
    await postPayRunLineAccrual({} as never, {
      userId: 'u1', lineId: 'l1', date: new Date('2026-05-05'),
      gross: '1000', net: '800', deductions: '200',
      wagesAccountId: 'a-9230', netPayableAccountId: 'a-9260', deductionsPayableAccountId: 'a-9270',
    });
    const [, userId, , sourceType, sourceId, event, lines] = gatedPost.mock.calls[0];
    expect(userId).toBe('u1');
    expect(sourceType).toBe('PayRunLine');
    expect(sourceId).toBe('l1');
    expect(event).toBe('accrued');
    const byAcc = Object.fromEntries((lines as any[]).map((l) => [l.accountId, l]));
    expect(byAcc['a-9230']).toMatchObject({ side: 'debit', amount: '1000' });
    expect(byAcc['a-9260']).toMatchObject({ side: 'credit', amount: '800' });
    expect(byAcc['a-9270']).toMatchObject({ side: 'credit', amount: '200' });
  });

  it('omits the deductions leg when deductions are zero', async () => {
    gatedPost.mockClear();
    await postPayRunLineAccrual({} as never, {
      userId: 'u1', lineId: 'l2', date: new Date('2026-05-05'),
      gross: '500', net: '500', deductions: '0',
      wagesAccountId: 'a-9230', netPayableAccountId: 'a-9260', deductionsPayableAccountId: 'a-9270',
    });
    const lines = gatedPost.mock.calls[0][6] as any[];
    expect(lines.map((l) => l.accountId)).toEqual(['a-9230', 'a-9260']);
  });
});
