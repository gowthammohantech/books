/**
 * Aging bucket drill-down helpers.
 *
 * The bucket boundaries live in @elixirbooks/money, shared with the backend's
 * aging reports, so a clicked bucket resolves to exactly the rows the number
 * came from. This file previously restated the backend's boundaries by hand
 * under a comment saying it "mirrors" them.
 */
import { AR_UNPAID_STATUSES_CSV, AP_UNPAID_STATUSES_CSV } from '@constants/statusFilters';

export { bucketDueWindow } from '@elixirbooks/money';
export type { AgingBucket as AgingBucketKey, DueWindow } from '@elixirbooks/money';

/**
 * The unpaid status sets the aging reports aggregate over (see agingController),
 * as the CSV the drill-down links pass as a query param. Derived from the Prisma
 * enums rather than hand-written literals — see @constants/statusFilters.
 */
export const AR_UNPAID_STATUSES = AR_UNPAID_STATUSES_CSV;
export const AP_UNPAID_STATUSES = AP_UNPAID_STATUSES_CSV;
