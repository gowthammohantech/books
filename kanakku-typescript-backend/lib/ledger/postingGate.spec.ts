// lib/ledger/postingGate.spec.ts
import { describe, it, expect } from 'vitest';
import { shouldPost, type LedgerSettings } from './postingGate';

const on: LedgerSettings = { ledgerInitialized: true, goLiveDate: new Date('2026-04-01') };

describe('shouldPost', () => {
  it('false when ledger not initialized', () => {
    expect(shouldPost({ ledgerInitialized: false, goLiveDate: new Date('2026-04-01') }, new Date('2026-06-01'))).toBe(false);
  });
  it('false when settings missing', () => {
    expect(shouldPost(null, new Date('2026-06-01'))).toBe(false);
  });
  it('false when goLiveDate missing', () => {
    expect(shouldPost({ ledgerInitialized: true, goLiveDate: null }, new Date('2026-06-01'))).toBe(false);
  });
  it('false when date is before goLiveDate', () => {
    expect(shouldPost(on, new Date('2026-03-31'))).toBe(false);
  });
  it('true when initialized and date on/after goLiveDate', () => {
    expect(shouldPost(on, new Date('2026-04-01'))).toBe(true);
    expect(shouldPost(on, new Date('2026-06-01'))).toBe(true);
  });

  // --- date-floor regression tests (GL tie-out critical) ---
  // goLiveDate stored as a full TIMESTAMP (e.g. set at 09:59:48 UTC).
  // Bank transactions are stored at midnight (00:00:00 UTC) for their calendar day.
  // Without date-floor the midnight txn would be < goLiveDate even on the SAME
  // calendar day, skipping the posting and silently breaking GL tie-out.
  it('true when txn is at midnight on the same calendar day as a daytime goLiveDate', () => {
    const goLive = new Date('2026-06-23T09:59:48Z'); // daytime go-live timestamp
    const txnDate = new Date('2026-06-23T00:00:00Z'); // bank txn stored at midnight
    const settings: LedgerSettings = { ledgerInitialized: true, goLiveDate: goLive };
    expect(shouldPost(settings, txnDate)).toBe(true);
  });

  it('false when txn is at midnight the day BEFORE a daytime goLiveDate', () => {
    const goLive = new Date('2026-06-23T09:59:48Z');
    const txnDate = new Date('2026-06-22T00:00:00Z'); // day before
    const settings: LedgerSettings = { ledgerInitialized: true, goLiveDate: goLive };
    expect(shouldPost(settings, txnDate)).toBe(false);
  });
});
