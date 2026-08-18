// lib/reports/cashFlowForecast.spec.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { forecastCashFlow, type ForecastBucket } from './cashFlowForecast';

// Helper: build a Date in a given year/month (1-based) on day 15
function monthDate(year: number, month: number, day = 15): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

describe('forecastCashFlow', () => {
  // Base scenario: openingCash=1000, 3 months starting 2024-06
  // inflow in month 2 (July), outflow in month 1 (June)
  const openingCash = '1000';
  const fromMonthIndex = new Date(Date.UTC(2024, 5, 1)); // 2024-06-01

  it('produces exactly `months` buckets', () => {
    const result = forecastCashFlow({
      openingCash,
      inflows: [],
      outflows: [],
      months: 3,
      fromMonthIndex,
    });
    expect(result.buckets).toHaveLength(3);
  });

  it('bucket monthStart values are first-of-month in UTC, starting fromMonthIndex', () => {
    const result = forecastCashFlow({
      openingCash,
      inflows: [],
      outflows: [],
      months: 3,
      fromMonthIndex,
    });
    expect(result.buckets[0].monthStart.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    expect(result.buckets[1].monthStart.toISOString()).toBe('2024-07-01T00:00:00.000Z');
    expect(result.buckets[2].monthStart.toISOString()).toBe('2024-08-01T00:00:00.000Z');
  });

  it('all-zero with no inflows/outflows; running cash stays at openingCash each month', () => {
    const result = forecastCashFlow({
      openingCash: '500',
      inflows: [],
      outflows: [],
      months: 2,
      fromMonthIndex,
    });
    expect(result.buckets[0].inflow).toBe('0.0000');
    expect(result.buckets[0].outflow).toBe('0.0000');
    expect(result.buckets[0].net).toBe('0.0000');
    // Running cash = openingCash + net(0) = 500
    expect(result.buckets[0].runningCash).toBe('500.0000');
    expect(result.buckets[1].runningCash).toBe('500.0000');
  });

  it('inflow in month 2 adds to runningCash correctly', () => {
    // openingCash=1000, inflow of 300 in July (bucket index 1)
    const result = forecastCashFlow({
      openingCash: '1000',
      inflows: [{ date: monthDate(2024, 7), amount: '300' }],
      outflows: [],
      months: 3,
      fromMonthIndex,
    });
    // month 1 (June): inflow=0, outflow=0, net=0, running=1000
    expect(result.buckets[0].runningCash).toBe('1000.0000');
    // month 2 (July): inflow=300, outflow=0, net=300, running=1300
    expect(result.buckets[1].inflow).toBe('300.0000');
    expect(result.buckets[1].net).toBe('300.0000');
    expect(result.buckets[1].runningCash).toBe('1300.0000');
    // month 3 (Aug): inflow=0, running=1300
    expect(result.buckets[2].runningCash).toBe('1300.0000');
  });

  it('outflow in month 1 reduces runningCash', () => {
    const result = forecastCashFlow({
      openingCash: '1000',
      inflows: [],
      outflows: [{ date: monthDate(2024, 6), amount: '200' }],
      months: 2,
      fromMonthIndex,
    });
    // month 1: outflow=200, net=-200, running=800
    expect(result.buckets[0].outflow).toBe('200.0000');
    expect(result.buckets[0].net).toBe('-200.0000');
    expect(result.buckets[0].runningCash).toBe('800.0000');
    // month 2: outflow=0, running=800
    expect(result.buckets[1].runningCash).toBe('800.0000');
  });

  it('3-month projection with one inflow + one outflow; running cash accumulates', () => {
    // Classic scenario from plan
    const result = forecastCashFlow({
      openingCash: '1000',
      inflows: [{ date: monthDate(2024, 7), amount: '500' }],   // July
      outflows: [{ date: monthDate(2024, 8), amount: '200' }],  // August
      months: 3,
      fromMonthIndex,
    });
    // Jun: +0 -0 = 0; running = 1000
    expect(result.buckets[0].runningCash).toBe('1000.0000');
    // Jul: +500 -0 = +500; running = 1500
    expect(result.buckets[1].runningCash).toBe('1500.0000');
    // Aug: +0 -200 = -200; running = 1300
    expect(result.buckets[2].runningCash).toBe('1300.0000');
    expect(result.droppedBeyondHorizon).toBe(0);
  });

  it('items before first bucket fold into month 1 (pre-window folding)', () => {
    // item dated in April (before June window) folds into June bucket
    const result = forecastCashFlow({
      openingCash: '0',
      inflows: [{ date: monthDate(2024, 4), amount: '800' }],
      outflows: [],
      months: 3,
      fromMonthIndex, // starts June
    });
    // folds into June bucket
    expect(result.buckets[0].inflow).toBe('800.0000');
    expect(result.buckets[0].runningCash).toBe('800.0000');
  });

  it('items beyond horizon are dropped and counted', () => {
    // horizon is 3 months from June → Jun, Jul, Aug. Sep item is dropped.
    const result = forecastCashFlow({
      openingCash: '0',
      inflows: [{ date: monthDate(2024, 9), amount: '999' }],
      outflows: [],
      months: 3,
      fromMonthIndex,
    });
    expect(result.droppedBeyondHorizon).toBe(1);
    // no inflow in any bucket
    for (const b of result.buckets) {
      expect(b.inflow).toBe('0.0000');
    }
  });

  it('multiple items in same month are summed', () => {
    const result = forecastCashFlow({
      openingCash: '0',
      inflows: [
        { date: monthDate(2024, 6, 5), amount: '100' },
        { date: monthDate(2024, 6, 20), amount: '200' },
      ],
      outflows: [],
      months: 1,
      fromMonthIndex,
    });
    expect(result.buckets[0].inflow).toBe('300.0000');
  });

  it('returns droppedBeyondHorizon=0 when all items are within horizon', () => {
    const result = forecastCashFlow({
      openingCash: '0',
      inflows: [{ date: monthDate(2024, 6), amount: '50' }],
      outflows: [],
      months: 3,
      fromMonthIndex,
    });
    expect(result.droppedBeyondHorizon).toBe(0);
  });

  it('uses Prisma.Decimal for precise arithmetic', () => {
    const result = forecastCashFlow({
      openingCash: '333.3333',
      inflows: [{ date: monthDate(2024, 6), amount: '666.6667' }],
      outflows: [],
      months: 1,
      fromMonthIndex,
    });
    // 333.3333 + 666.6667 = 1000.0000 exactly with Decimal
    expect(new Prisma.Decimal(result.buckets[0].runningCash).equals(new Prisma.Decimal('1000.0000'))).toBe(true);
  });
});
