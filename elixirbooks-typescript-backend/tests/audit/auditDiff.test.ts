import { describe, it, expect } from 'vitest';
import { computeDiff, redactChanges, REDACTED } from '../../lib/auditDiff';

describe('computeDiff', () => {
  it('records only changed scalar fields', () => {
    const diff = computeDiff({ a: 1, b: 'x', c: true }, { a: 2, b: 'x', c: false });
    expect(diff).toEqual([
      { field: 'a', old: 1, new: 2 },
      { field: 'c', old: true, new: false },
    ]);
  });

  it('detects added and removed fields', () => {
    const diff = computeDiff({ a: 1 }, { a: 1, b: 2 });
    expect(diff).toEqual([{ field: 'b', old: undefined, new: 2 }]);
  });

  it('compares object/JSON fields by serialized value', () => {
    expect(computeDiff({ j: { x: 1 } }, { j: { x: 1 } })).toEqual([]);
    expect(computeDiff({ j: { x: 1 } }, { j: { x: 2 } })).toEqual([
      { field: 'j', old: { x: 1 }, new: { x: 2 } },
    ]);
  });

  it('treats a null before (create) as all-new', () => {
    expect(computeDiff(null, { a: 1 })).toEqual([{ field: 'a', old: undefined, new: 1 }]);
  });
});

describe('redactChanges', () => {
  it('masks sensitive field values but keeps the field entry', () => {
    const out = redactChanges([
      { field: 'password', old: 'a', new: 'b' },
      { field: 'authToken', old: 't1', new: 't2' },
      { field: 'name', old: 'x', new: 'y' },
    ]);
    expect(out).toEqual([
      { field: 'password', old: REDACTED, new: REDACTED },
      { field: 'authToken', old: REDACTED, new: REDACTED },
      { field: 'name', old: 'x', new: 'y' },
    ]);
  });
});
