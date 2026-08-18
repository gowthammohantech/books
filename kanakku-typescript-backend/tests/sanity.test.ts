import { describe, it, expect } from 'vitest';

describe('toolchain sanity', () => {
  it('runs a TypeScript test', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 3)).toBe(5);
  });

  it('has Node 20+ at runtime', () => {
    const [major] = process.versions.node.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
