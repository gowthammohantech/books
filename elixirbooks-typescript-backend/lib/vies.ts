/**
 * OPTIONAL online EU VIES VAT-number validation.
 *
 * VIES (VAT Information Exchange System) is the EU's online service for verifying
 * that a VAT number is registered and active. This is an OUTBOUND call to an EU
 * government endpoint — a "phone-home" — so it is OFF BY DEFAULT and only invoked
 * when a tenant has explicitly enabled `CompanySettings.viesValidationEnabled`.
 *
 * Design pillars (do not weaken):
 *   - FAIL-OPEN: any error, timeout, abort, rate-limit, or non-2xx response falls
 *     back to the existing STRUCTURAL check (`lib/euVat.ts parseVatNumber`) and is
 *     reported with `source: 'offline'`. We never treat an unreachable VIES as
 *     "invalid".
 *   - NON-BLOCKING: callers must NEVER reject a save based on the result. A VIES
 *     "invalid" flags the contact (`checked:true, valid:false`) but the save still
 *     proceeds.
 *   - GB is NOT in VIES (post-Brexit). GB and any non-EU prefix are resolved
 *     structurally without any network call.
 *
 * Uses the current VIES REST API:
 *   POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number
 *   body: { "countryCode": "DE", "vatNumber": "123456789" }
 *   resp: { "valid": true|false, "name": "...", ... }
 */
import { parseVatNumber, isEuMember } from './euVat';

const VIES_REST_URL =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

const DEFAULT_TIMEOUT_MS = 5000;

export interface VatValidationResult {
  /** True iff an authoritative VIES answer was obtained. False = fail-open/offline. */
  checked: boolean;
  /** Validity. When checked, this is VIES's answer; otherwise the structural result. */
  valid: boolean;
  /** Trader name as returned by VIES (only present on a successful VIES check). */
  name?: string;
  /** 'vies' = authoritative online answer; 'offline' = structural fallback. */
  source: 'vies' | 'offline';
}

interface ViesResponseBody {
  valid?: boolean;
  name?: string;
}

/**
 * Validate a VAT number online against the EU VIES service.
 *
 * Country prefix is stripped before the request (VIES wants countryCode +
 * bare vatNumber). GB and non-EU prefixes resolve structurally with no call.
 * On ANY failure path, returns the structural `parseVatNumber` result tagged
 * `source:'offline'` (fail-open) — never throws on a network/parse error.
 */
export async function validateVatOnline(
  vat: string,
  opts?: { timeoutMs?: number },
): Promise<VatValidationResult> {
  const parsed = parseVatNumber(vat);
  const structuralValid = parsed.valid;

  // GB (post-Brexit) and any non-EU prefix are not covered by VIES — resolve
  // structurally with no outbound call.
  if (!isEuMember(parsed.country)) {
    return { checked: false, valid: structuralValid, source: 'offline' };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(VIES_REST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode: parsed.country, vatNumber: parsed.number }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      // Non-2xx (rate-limit, server error, etc.) -> fail-open.
      return { checked: false, valid: structuralValid, source: 'offline' };
    }

    const body = (await resp.json()) as ViesResponseBody;
    const valid = body.valid === true;
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name : undefined;

    return name !== undefined
      ? { checked: true, valid, name, source: 'vies' }
      : { checked: true, valid, source: 'vies' };
  } catch {
    // Timeout / abort / network error / JSON parse error -> fail-open.
    return { checked: false, valid: structuralValid, source: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
