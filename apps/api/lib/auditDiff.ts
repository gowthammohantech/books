export const REDACTED = '[REDACTED]';

export interface Change {
  field: string;
  old: unknown;
  new: unknown;
}

const SENSITIVE = /pass(word)?|token|secret|api_?key|_key$|\botp\b|mfa|salt|hash/i;

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Change[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes: Change[] = [];
  for (const field of keys) {
    if (!equal(b[field], a[field])) {
      changes.push({ field, old: b[field], new: a[field] });
    }
  }
  return changes;
}

export function redactChanges(changes: Change[]): Change[] {
  return changes.map((c) =>
    SENSITIVE.test(c.field) ? { field: c.field, old: REDACTED, new: REDACTED } : c,
  );
}

module.exports = { REDACTED, computeDiff, redactChanges };
module.exports.REDACTED = REDACTED;
module.exports.computeDiff = computeDiff;
module.exports.redactChanges = redactChanges;
