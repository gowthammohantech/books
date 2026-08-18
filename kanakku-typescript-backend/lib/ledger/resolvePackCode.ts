import { COUNTRY_CODES } from './packs';
import { isEuMember } from '../euVat';

/** Map an ISO-2 country code to a supported ledger pack code.
 *  UK is not a valid ISO-2 (GB is) but is guarded for safety.
 *
 *  EU member states (DE, FR, NL, ...) have no per-country pack of their own; they
 *  share the single generic `EU` pack (regime VAT_EU). They MUST route to `EU`,
 *  NOT fall back to `GB` (the old bug gave a German tenant the UK pack). The
 *  tenant's real member ISO-2 is preserved separately by the apply path (see
 *  `applyPack` storedCountryCode) so VAT rate + reverse-charge resolve correctly.
 *
 *  Falls back to 'GB' for any unknown or missing non-EU code.
 */
export function resolvePackCode(iso2?: string | null): string {
  const c = (iso2 || '').toUpperCase();
  if (c === 'UK') return 'GB';
  if (isEuMember(c)) return 'EU';
  return COUNTRY_CODES.includes(c) ? c : 'GB';
}
