// Money formatting for unauthenticated public pages (invoice/quotation share
// links). These pages have no redux store / auth session, so this stays
// fully self-contained — no imports from settings, redux, or hooks.

/**
 * Formats a money amount for a public (token-gated) viewer page.
 *
 * - When a currency code is present, renders with the currency's symbol via
 *   `Intl.NumberFormat`'s currency style.
 * - When the code is absent (older payloads that predate currency on the
 *   public contract) or invalid/unrecognized, falls back to plain grouped
 *   2-decimal formatting so the page never throws or shows raw numbers.
 */
export function formatPublicMoney(amount: number, currencyCode?: string | null): string {
  const value = Number.isFinite(amount) ? amount : 0;

  if (currencyCode) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
      }).format(value);
    } catch {
      // Unknown/invalid ISO currency code — fall through to plain grouping.
    }
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default formatPublicMoney;
