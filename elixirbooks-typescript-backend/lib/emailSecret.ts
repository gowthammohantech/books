import { encrypt, decrypt } from './aiCrypto';

/**
 * At-rest encryption for EmailSettings secrets (smtpPassword, nodePassword,
 * resendApiKey). Unlike AiConfig — which was built with dedicated encrypted
 * columns from day one — these columns already hold PLAINTEXT on existing
 * installs, so we encrypt in place behind an `enc::` marker:
 *   - encryptSecret() -> "enc::<aes-256-gcm base64>"
 *   - decryptSecret()  -> decrypts marked values; returns legacy plaintext
 *     (no marker) unchanged, so existing rows keep working until their next
 *     save re-encrypts them.
 *
 * Key handling is delegated to lib/aiCrypto (AI_ENCRYPTION_KEY, else derived
 * from JWT_SECRET).
 */
const PREFIX = 'enc::';

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  return PREFIX + encrypt(plaintext);
}

/** Returns the plaintext secret, or '' for null/empty. Legacy plaintext (no
 *  marker) is returned as-is for backward compatibility. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (isEncrypted(stored)) return decrypt(stored.slice(PREFIX.length));
  return stored;
}

// CommonJS interop for the JS mailer (utils/mailer.js).
module.exports = { isEncrypted, encryptSecret, decryptSecret };
module.exports.isEncrypted = isEncrypted;
module.exports.encryptSecret = encryptSecret;
module.exports.decryptSecret = decryptSecret;
