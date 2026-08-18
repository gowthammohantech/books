import { describe, it, expect } from 'vitest';
import { getAuditContext, runWithAuditContext } from '../../lib/auditContext';

describe('auditContext store', () => {
  it('returns undefined outside any run scope', () => {
    expect(getAuditContext()).toBeUndefined();
  });

  it('exposes the context inside a run scope', () => {
    const ctx = { userId: 'u1', userName: 'Asha', ipAddress: '127.0.0.1', userAgent: 'jest' };
    const seen = runWithAuditContext(ctx, () => getAuditContext());
    expect(seen).toEqual(ctx);
  });

  it('isolates nested scopes', () => {
    const result = runWithAuditContext(
      { userId: 'a', userName: 'A' },
      () => runWithAuditContext({ userId: 'b', userName: 'B' }, () => getAuditContext()?.userId),
    );
    expect(result).toBe('b');
  });
});
