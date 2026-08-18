// lib/reports/cashFlowForecast.ts
import { Prisma } from '@prisma/client';

export interface CashFlowItem {
  date: Date;
  /** Decimal string — amount (positive) */
  amount: string;
}

export interface ForecastInput {
  /** Decimal string — opening cash balance */
  openingCash: string;
  /** Open AR items (invoices outstanding) — each with dueDate and outstanding amount */
  inflows: CashFlowItem[];
  /** Open AP items (purchases balance) — each with dueDate and balance amount */
  outflows: CashFlowItem[];
  /** Number of monthly buckets to project */
  months: number;
  /**
   * The month containing this date is the first bucket.
   * Typically new Date() (today), but injectable for testing.
   */
  fromMonthIndex: Date;
}

export interface ForecastBucket {
  /** UTC first-of-month for this bucket */
  monthStart: Date;
  /** Total inflows for this month (Decimal string, 4dp) */
  inflow: string;
  /** Total outflows for this month (Decimal string, 4dp) */
  outflow: string;
  /** inflow − outflow (Decimal string, 4dp) */
  net: string;
  /** Cumulative cash after this month's net (Decimal string, 4dp) */
  runningCash: string;
}

export interface ForecastResult {
  buckets: ForecastBucket[];
  /** Count of items with dates beyond the last bucket (dropped from projection) */
  droppedBeyondHorizon: number;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Returns the UTC first-of-month for a given date.
 */
function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Adds `n` months to a UTC first-of-month Date, staying on first-of-month.
 */
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/**
 * Returns true if date `d` is in the same UTC year+month as `bucket`.
 */
function sameMonth(d: Date, bucket: Date): boolean {
  return d.getUTCFullYear() === bucket.getUTCFullYear() && d.getUTCMonth() === bucket.getUTCMonth();
}

/**
 * Pure function — projects monthly cash-flow buckets.
 *
 * Rules:
 * - `months` buckets are created, starting with the month containing `fromMonthIndex`.
 * - Items dated before the first bucket fold into bucket 0 (pre-window folding).
 * - Items dated beyond the last bucket are dropped; their count is returned as `droppedBeyondHorizon`.
 * - Running cash starts at `openingCash` and accumulates `net` each month.
 */
export function forecastCashFlow(input: ForecastInput): ForecastResult {
  const { openingCash, inflows, outflows, months, fromMonthIndex } = input;

  // Build bucket start dates
  const firstBucket = firstOfMonth(fromMonthIndex);
  const bucketStarts: Date[] = [];
  for (let i = 0; i < months; i++) {
    bucketStarts.push(addMonths(firstBucket, i));
  }
  const lastBucket = bucketStarts[bucketStarts.length - 1];
  // One-past-the-end: anything in this month or later is beyond horizon
  const horizonEnd = addMonths(lastBucket, 1);

  // Initialise accumulator arrays
  const inflowBuckets = bucketStarts.map(() => ZERO);
  const outflowBuckets = bucketStarts.map(() => ZERO);
  let droppedBeyondHorizon = 0;

  function assignItem(items: CashFlowItem[], buckets: Prisma.Decimal[]): void {
    for (const item of items) {
      const amt = new Prisma.Decimal(item.amount);

      // Beyond horizon — drop
      if (item.date >= horizonEnd) {
        droppedBeyondHorizon++;
        continue;
      }

      // Before first bucket — fold into bucket 0
      if (item.date < firstBucket) {
        buckets[0] = buckets[0].plus(amt);
        continue;
      }

      // Find the matching bucket
      for (let i = 0; i < bucketStarts.length; i++) {
        if (sameMonth(item.date, bucketStarts[i])) {
          buckets[i] = buckets[i].plus(amt);
          break;
        }
      }
    }
  }

  assignItem(inflows, inflowBuckets);
  assignItem(outflows, outflowBuckets);

  // Build result buckets with running cash
  let running = new Prisma.Decimal(openingCash);
  const resultBuckets: ForecastBucket[] = bucketStarts.map((monthStart, i) => {
    const inflow = inflowBuckets[i];
    const outflow = outflowBuckets[i];
    const net = inflow.minus(outflow);
    running = running.plus(net);

    return {
      monthStart,
      inflow: inflow.toFixed(4),
      outflow: outflow.toFixed(4),
      net: net.toFixed(4),
      runningCash: running.toFixed(4),
    };
  });

  return { buckets: resultBuckets, droppedBeyondHorizon };
}
