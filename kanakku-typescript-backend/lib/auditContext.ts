import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditContext {
  userId?: string | null;
  userName: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

// CommonJS interop for legacy JS requires.
module.exports = { runWithAuditContext, getAuditContext };
module.exports.runWithAuditContext = runWithAuditContext;
module.exports.getAuditContext = getAuditContext;
