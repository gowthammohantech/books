import { describe, it, expect } from 'vitest';
import {
  computeNextRun,
  isDue,
  advanceAfterRun,
  reanchorOnResume,
  type Cadence,
} from '../../lib/recurring/schedule';

// Helper: UTC-midnight date from an ISO date string (YYYY-MM-DD).
const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('computeNextRun', () => {
  it('advances by one day for daily cadence', () => {
    expect(computeNextRun(d('2026-01-15'), { repeatEvery: 'day' })).toEqual(d('2026-01-16'));
  });

  it('advances by seven days for weekly cadence', () => {
    expect(computeNextRun(d('2026-01-15'), { repeatEvery: 'week' })).toEqual(d('2026-01-22'));
  });

  it('advances by one month for monthly cadence', () => {
    expect(computeNextRun(d('2026-01-15'), { repeatEvery: 'month' })).toEqual(d('2026-02-15'));
  });

  it('advances by one year for yearly cadence', () => {
    expect(computeNextRun(d('2026-01-15'), { repeatEvery: 'year' })).toEqual(d('2027-01-15'));
  });

  it('advances by customIntervalNumber x customIntervalType for custom cadence', () => {
    const cadence: Cadence = {
      repeatEvery: 'custom',
      customIntervalNumber: 3,
      customIntervalType: 'week',
    };
    expect(computeNextRun(d('2026-01-15'), cadence)).toEqual(d('2026-02-05'));
  });

  it('rolls over month/year boundaries using UTC math', () => {
    expect(computeNextRun(d('2026-12-15'), { repeatEvery: 'month' })).toEqual(d('2027-01-15'));
  });

  it('does not mutate the input date', () => {
    const from = d('2026-01-15');
    computeNextRun(from, { repeatEvery: 'month' });
    expect(from).toEqual(d('2026-01-15'));
  });
});

describe('isDue', () => {
  const today = d('2026-02-01');

  it('is true when ACTIVE and nextRunDate <= today', () => {
    expect(isDue({ status: 'ACTIVE', nextRunDate: d('2026-02-01') }, today)).toBe(true);
    expect(isDue({ status: 'ACTIVE', nextRunDate: d('2026-01-15') }, today)).toBe(true);
  });

  it('is false when paused', () => {
    expect(isDue({ status: 'PAUSED', nextRunDate: d('2026-01-15') }, today)).toBe(false);
  });

  it('is false when nextRunDate is in the future', () => {
    expect(isDue({ status: 'ACTIVE', nextRunDate: d('2026-03-01') }, today)).toBe(false);
  });

  it('is false when nextRunDate is null', () => {
    expect(isDue({ status: 'ACTIVE', nextRunDate: null }, today)).toBe(false);
  });
});

describe('advanceAfterRun', () => {
  const base = {
    startOn: d('2026-01-15'),
    endsOn: null as Date | null,
    neverExpire: false,
    maxOccurrences: null as number | null,
    occurrencesCount: 0,
    cadence: { repeatEvery: 'month' } as Cadence,
  };

  it('advances normally → ACTIVE with next run and incremented count', () => {
    const out = advanceAfterRun(base, d('2026-01-15'));
    expect(out.status).toBe('ACTIVE');
    expect(out.occurrencesCount).toBe(1);
    expect(out.nextRunDate).toEqual(d('2026-02-15'));
  });

  it('completes when reaching maxOccurrences', () => {
    const out = advanceAfterRun(
      { ...base, maxOccurrences: 3, occurrencesCount: 2 },
      d('2026-03-15'),
    );
    expect(out.status).toBe('COMPLETED');
    expect(out.occurrencesCount).toBe(3);
    expect(out.nextRunDate).toBeNull();
  });

  it('completes when the next run would fall beyond endsOn', () => {
    const out = advanceAfterRun(
      { ...base, endsOn: d('2026-02-10') },
      d('2026-01-15'),
    );
    // next would be 2026-02-15, which is > endsOn 2026-02-10
    expect(out.status).toBe('COMPLETED');
    expect(out.nextRunDate).toBeNull();
  });

  it('stays ACTIVE when the next run is on or before endsOn', () => {
    const out = advanceAfterRun(
      { ...base, endsOn: d('2026-02-15') },
      d('2026-01-15'),
    );
    expect(out.status).toBe('ACTIVE');
    expect(out.nextRunDate).toEqual(d('2026-02-15'));
  });

  it('ignores endsOn when neverExpire is true', () => {
    const out = advanceAfterRun(
      { ...base, endsOn: d('2026-02-10'), neverExpire: true },
      d('2026-01-15'),
    );
    expect(out.status).toBe('ACTIVE');
    expect(out.nextRunDate).toEqual(d('2026-02-15'));
  });
});

describe('reanchorOnResume', () => {
  const cadence: Cadence = { repeatEvery: 'month' };
  const today = d('2026-06-01');

  it('bumps a past nextRunDate to the next future occurrence from today', () => {
    const out = reanchorOnResume({ nextRunDate: d('2026-01-15'), cadence }, today);
    expect(out).toEqual(computeNextRun(today, cadence));
    expect(out.getTime()).toBeGreaterThan(today.getTime());
  });

  it('bumps a null nextRunDate to the next occurrence from today', () => {
    const out = reanchorOnResume({ nextRunDate: null, cadence }, today);
    expect(out).toEqual(computeNextRun(today, cadence));
  });

  it('keeps a future nextRunDate unchanged', () => {
    const future = d('2026-07-15');
    const out = reanchorOnResume({ nextRunDate: future, cadence }, today);
    expect(out).toEqual(future);
  });

  it('keeps a nextRunDate that is exactly today unchanged', () => {
    const out = reanchorOnResume({ nextRunDate: today, cadence }, today);
    expect(out).toEqual(today);
  });
});
