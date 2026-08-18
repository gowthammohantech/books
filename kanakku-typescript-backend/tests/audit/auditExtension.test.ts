import { describe, it, expect } from 'vitest';
import { isAuditable, buildAuditRecord, DENYLIST } from '../../lib/auditExtension';

describe('isAuditable', () => {
  it('logs write operations on normal models', () => {
    expect(isAuditable('Invoice', 'update')).toBe(true);
    expect(isAuditable('Invoice', 'create')).toBe(true);
    expect(isAuditable('Invoice', 'deleteMany')).toBe(true);
  });
  it('skips reads', () => {
    expect(isAuditable('Invoice', 'findMany')).toBe(false);
  });
  it('skips denylisted models and AuditLog itself', () => {
    expect(DENYLIST.has('AuditLog')).toBe(true);
    expect(isAuditable('AuditLog', 'create')).toBe(false);
    expect(isAuditable('AiUsageLog', 'create')).toBe(false);
    expect(isAuditable('LoginActivity', 'create')).toBe(false);
  });
  it('skips when model is undefined', () => {
    expect(isAuditable(undefined, 'create')).toBe(false);
  });
});

describe('buildAuditRecord', () => {
  const ctx = { userId: 'u1', userName: 'Asha', ipAddress: '1.1.1.1', userAgent: 'ua' };

  it('builds a CREATE record from the result', () => {
    const rec = buildAuditRecord({
      model: 'Customer', operation: 'create', ctx,
      before: null, result: { id: 'c1', name: 'Acme', password: 'p' },
    });
    expect(rec).toMatchObject({
      action: 'CREATE', entityType: 'Customer', entityId: 'c1',
      entityLabel: 'Acme', userId: 'u1', userName: 'Asha',
      ipAddress: '1.1.1.1', userAgent: 'ua',
    });
    expect(rec.summary).toBe('Created Customer Acme');
    const pw = (rec.changes as any[]).find((c) => c.field === 'password');
    expect(pw.new).toBe('[REDACTED]');
  });

  it('builds an UPDATE record with a before/after diff', () => {
    const rec = buildAuditRecord({
      model: 'Invoice', operation: 'update', ctx,
      before: { id: 'i1', invoiceNumber: 'INV-1', status: 'draft' },
      result: { id: 'i1', invoiceNumber: 'INV-1', status: 'paid' },
    });
    expect(rec.action).toBe('UPDATE');
    expect(rec.entityLabel).toBe('INV-1');
    expect(rec.changes).toEqual([{ field: 'status', old: 'draft', new: 'paid' }]);
    expect(rec.summary).toBe('Updated Invoice INV-1');
  });

  it('builds a DELETE record snapshotting the before row', () => {
    const rec = buildAuditRecord({
      model: 'Customer', operation: 'delete', ctx,
      before: { id: 'c1', name: 'Acme' }, result: { id: 'c1', name: 'Acme' },
    });
    expect(rec.action).toBe('DELETE');
    expect(rec.entityId).toBe('c1');
    expect(rec.summary).toBe('Deleted Customer Acme');
  });

  it('builds a bulk summary for updateMany/deleteMany', () => {
    const rec = buildAuditRecord({
      model: 'Invoice', operation: 'deleteMany', ctx,
      before: null, result: { count: 5 },
    });
    expect(rec.action).toBe('DELETE');
    expect(rec.entityId).toBeNull();
    expect(rec.affectedCount).toBe(5);
    expect(rec.changes).toBeNull();
    expect(rec.summary).toBe('Deleted 5 Invoice records');
  });

  it('defaults to system when no context', () => {
    const rec = buildAuditRecord({
      model: 'Customer', operation: 'create', ctx: undefined,
      before: null, result: { id: 'c1', name: 'Acme' },
    });
    expect(rec.userId).toBeNull();
    expect(rec.userName).toBe('system');
  });

  it('logs an upsert that creates (before is null) as CREATE', () => {
    const rec = buildAuditRecord({
      model: 'Customer', operation: 'upsert', ctx,
      before: null, result: { id: 'c2', name: 'NewCo' },
    });
    expect(rec.action).toBe('CREATE');
    expect(rec.summary).toBe('Created Customer NewCo');
    expect(rec.changes).toEqual([{ field: 'id', old: undefined, new: 'c2' }, { field: 'name', old: undefined, new: 'NewCo' }]);
  });

  it('logs an upsert that updates (before exists) as UPDATE', () => {
    const rec = buildAuditRecord({
      model: 'Customer', operation: 'upsert', ctx,
      before: { id: 'c2', name: 'OldCo' }, result: { id: 'c2', name: 'NewCo' },
    });
    expect(rec.action).toBe('UPDATE');
    expect(rec.summary).toBe('Updated Customer NewCo');
    expect(rec.changes).toEqual([{ field: 'name', old: 'OldCo', new: 'NewCo' }]);
  });

  it('builds a bulk CREATE summary for createMany', () => {
    const rec = buildAuditRecord({
      model: 'Invoice', operation: 'createMany', ctx,
      before: null, result: { count: 3 },
    });
    expect(rec.action).toBe('CREATE');
    expect(rec.affectedCount).toBe(3);
    expect(rec.changes).toBeNull();
    expect(rec.summary).toBe('Created 3 Invoice records');
  });
});
