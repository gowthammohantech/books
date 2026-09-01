/**
 * Rounds a number to 2 decimal places, so document totals sent to the API and
 * shown on screen always agree to the cent.
 *
 * This used to be `Math.round((value + Number.EPSILON) * 100) / 100`, which
 * rounds a .xx5 boundary DOWN wherever the binary float sits just below it —
 * disagreeing with the server's Decimal ROUND_HALF_UP on about one line in 825.
 * It now delegates to @elixirbooks/money, the same implementation the server
 * uses, so the preview and the persisted value cannot drift.
 *
 * Still returns a `number`: the Decimal is an implementation detail of the
 * arithmetic and deliberately does not cross into component props.
 */
export { round2Number as round2 } from '@elixirbooks/money';
