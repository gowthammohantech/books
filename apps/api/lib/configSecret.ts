import { decryptSecret, encryptSecret, isEncrypted } from './emailSecret';

/**
 * At-rest encryption for secrets stored *inside* JSON config blobs
 * (GatewayConfig.config, MessagingConfig.whatsappConfig,
 * AccountingIntegration.config). These columns hold a JSON object where some
 * keys are secrets (API/secret keys, webhook secrets, OAuth tokens) and others
 * are public (keyId, publishableKey, redirect URLs, provider name).
 *
 * Like lib/emailSecret, existing rows hold PLAINTEXT, so we encrypt selected
 * keys in place behind the same `enc::` marker. Decryption is marker-aware:
 * legacy plaintext (no marker) is returned unchanged so existing configs keep
 * working until their next save re-encrypts them.
 *
 *   - encryptConfigSecrets(config, secretKeys)
 *       -> returns a copy with each named string key replaced by "enc::<...>".
 *   - decryptConfigSecrets(config, secretKeys)
 *       -> returns a copy with each named key decrypted (point-of-use only).
 *   - maskConfig(config, secretKeys)
 *       -> returns a SAFE copy for API responses: public keys passed through,
 *          secret keys removed and replaced by has<Key>: boolean flags. The
 *          plaintext/ciphertext of a secret is NEVER returned to the client.
 *
 * Key handling is delegated to lib/aiCrypto via lib/emailSecret.
 */

type Json = Record<string, unknown>;

/**
 * Secret keys per integration kind. Anything NOT listed here is treated as
 * public (keyId, publishableKey, redirect/success/cancel URLs, clientId,
 * provider name, state, tenantId, timestamps) and may be returned to clients.
 */
export const GATEWAY_SECRET_KEYS: Record<string, readonly string[]> = {
  RAZORPAY: ['keySecret', 'webhookSecret'],
  STRIPE: ['secretKey', 'webhookSecret'],
  OFFLINE: [],
};

export const ACCOUNTING_SECRET_KEYS = ['accessToken', 'refreshToken'] as const;

export const WHATSAPP_SECRET_KEYS = [
  'authToken', // Twilio auth token
  'accessToken', // WhatsApp Cloud API token
  'apiKey',
  'apiSecret',
  'token',
] as const;

export function gatewaySecretKeys(kind: string): readonly string[] {
  return GATEWAY_SECRET_KEYS[kind] ?? [];
}

function asObject(config: unknown): Json {
  return config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Json) }
    : {};
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Encrypt the named secret keys on write. Non-string / empty values are left
 *  as-is. Already-encrypted values (enc:: marker) are not double-encrypted. */
export function encryptConfigSecrets(config: unknown, secretKeys: readonly string[]): Json {
  const out = asObject(config);
  for (const key of secretKeys) {
    const v = out[key];
    if (typeof v === 'string' && v !== '' && !isEncrypted(v)) {
      out[key] = encryptSecret(v);
    }
  }
  return out;
}

/** Decrypt the named secret keys at point-of-use. Legacy plaintext (no marker)
 *  is returned unchanged for backward compatibility. */
export function decryptConfigSecrets(config: unknown, secretKeys: readonly string[]): Json {
  const out = asObject(config);
  for (const key of secretKeys) {
    const v = out[key];
    if (typeof v === 'string' && v !== '') {
      out[key] = decryptSecret(v);
    }
  }
  return out;
}

/**
 * Merge an incoming config with the stored one so a blank/omitted secret keeps
 * the previously stored (encrypted) value — "blank-keeps-current". Non-secret
 * keys from the incoming config always win; secret keys only overwrite when a
 * non-empty value is supplied. The returned object has every supplied secret
 * encrypted at rest.
 */
export function mergeAndEncryptConfig(
  incoming: unknown,
  stored: unknown,
  secretKeys: readonly string[],
): Json {
  const incomingObj = asObject(incoming);
  const storedObj = asObject(stored);
  const secretSet = new Set(secretKeys);

  // Start from incoming for all non-secret fields.
  const out: Json = {};
  for (const [k, v] of Object.entries(incomingObj)) {
    if (!secretSet.has(k)) out[k] = v;
  }

  for (const key of secretKeys) {
    const incomingVal = incomingObj[key];
    if (typeof incomingVal === 'string' && incomingVal.trim() !== '') {
      out[key] = isEncrypted(incomingVal) ? incomingVal : encryptSecret(incomingVal);
    } else if (storedObj[key] !== undefined) {
      // blank/omitted -> keep the stored (already-encrypted-or-legacy) secret
      out[key] = storedObj[key];
    }
  }
  return out;
}

/**
 * Produce a client-safe view of a config: secret keys are stripped and replaced
 * with has<Key> boolean flags; every other key is passed through verbatim.
 */
export function maskConfig(config: unknown, secretKeys: readonly string[]): Json {
  const obj = asObject(config);
  const secretSet = new Set(secretKeys);
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!secretSet.has(k)) out[k] = v;
  }
  for (const key of secretKeys) {
    const v = obj[key];
    out[`has${capitalize(key)}`] = typeof v === 'string' && v !== '';
  }
  return out;
}
