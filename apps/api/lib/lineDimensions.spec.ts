// lib/lineDimensions.spec.ts
import { describe, it, expect, vi } from 'vitest';
import {
  LINE_CENTRE_NONE,
  resolveLineCostCenterId,
  collectCostCentreIds,
  assertCostCentresExist,
  UnknownCostCentreError,
} from './lineDimensions';

describe('resolveLineCostCenterId', () => {
  it('inherits the header when the line says nothing', () => {
    expect(resolveLineCostCenterId(undefined, 'cc-header')).toBe('cc-header');
    expect(resolveLineCostCenterId(null, 'cc-header')).toBe('cc-header');
  });

  it('inherits the header for an empty string', () => {
    // Multipart form-data posts an untouched select as '', and '' must keep
    // meaning "inherit" — that is the common case for every line.
    expect(resolveLineCostCenterId('', 'cc-header')).toBe('cc-header');
    expect(resolveLineCostCenterId('   ', 'cc-header')).toBe('cc-header');
  });

  it('honours an explicit line override', () => {
    expect(resolveLineCostCenterId('cc-line', 'cc-header')).toBe('cc-line');
  });

  it('treats the __none__ sentinel as explicitly untagged', () => {
    expect(resolveLineCostCenterId(LINE_CENTRE_NONE, 'cc-header')).toBeNull();
  });

  it('returns null when neither line nor header has a centre', () => {
    expect(resolveLineCostCenterId(undefined, null)).toBeNull();
    expect(resolveLineCostCenterId('', null)).toBeNull();
  });

  it('reads a legacy item with no costCenterId as the header centre', () => {
    // Items stored before this feature have no key at all; they must report
    // exactly as they did before, i.e. under the document's centre.
    const legacyItem: { costCenterId?: string | null } = { };
    expect(resolveLineCostCenterId(legacyItem.costCenterId, 'cc-header')).toBe('cc-header');
  });
});

describe('collectCostCentreIds', () => {
  it('gathers the header and every distinct line centre', () => {
    const ids = collectCostCentreIds('cc-h', [
      { costCenterId: 'cc-a' },
      { costCenterId: 'cc-b' },
      { costCenterId: 'cc-a' },
    ]);
    expect(ids.sort()).toEqual(['cc-a', 'cc-b', 'cc-h']);
  });

  it('skips nulls and returns [] when nothing is tagged', () => {
    expect(collectCostCentreIds(null, [{ costCenterId: null }, {}])).toEqual([]);
  });
});

describe('assertCostCentresExist', () => {
  const txWith = (found: string[]) => ({
    costCenter: { findMany: vi.fn().mockResolvedValue(found.map((id) => ({ id }))) },
  });

  it('passes when every id resolves', async () => {
    const tx = txWith(['cc-a', 'cc-b']);
    await expect(assertCostCentresExist(tx as never, 'u1', ['cc-a', 'cc-b'])).resolves.toBeUndefined();
  });

  it('does not query at all for an untagged document', async () => {
    const tx = txWith([]);
    await assertCostCentresExist(tx as never, 'u1', []);
    expect(tx.costCenter.findMany).not.toHaveBeenCalled();
  });

  it('throws naming the ids that do not resolve', async () => {
    // The items JSON has no FK, so this is the only thing standing between a
    // typo'd id and a silently wrong departmental P&L.
    const tx = txWith(['cc-a']);
    await expect(assertCostCentresExist(tx as never, 'u1', ['cc-a', 'cc-ghost']))
      .rejects.toThrow(UnknownCostCentreError);
    await expect(assertCostCentresExist(tx as never, 'u1', ['cc-a', 'cc-ghost']))
      .rejects.toThrow(/cc-ghost/);
  });

  it('scopes the lookup to the tenant and excludes deleted centres', async () => {
    const tx = txWith(['cc-a']);
    await assertCostCentresExist(tx as never, 'u1', ['cc-a']);
    expect(tx.costCenter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'u1', isDeleted: false }),
      }),
    );
  });

  it('uses a single query regardless of how many centres are referenced', async () => {
    const tx = txWith(['cc-a', 'cc-b', 'cc-c', 'cc-d']);
    await assertCostCentresExist(tx as never, 'u1', ['cc-a', 'cc-b', 'cc-c', 'cc-d']);
    expect(tx.costCenter.findMany).toHaveBeenCalledOnce();
  });
});
