// lib/ledger/approvals.spec.ts
import { describe, it, expect } from 'vitest';
import { initialApprovalStatus, shouldPostOnCreate } from './approvals';

describe('initialApprovalStatus', () => {
  it('returns PENDING when approvals are enabled', () => {
    expect(initialApprovalStatus(true)).toBe('PENDING');
  });

  it('returns NOT_REQUIRED when approvals are disabled', () => {
    expect(initialApprovalStatus(false)).toBe('NOT_REQUIRED');
  });
});

describe('shouldPostOnCreate', () => {
  it('returns true (post immediately) when approvals disabled', () => {
    expect(shouldPostOnCreate(false)).toBe(true);
  });

  it('returns false (defer) when approvals enabled', () => {
    expect(shouldPostOnCreate(true)).toBe(false);
  });
});
