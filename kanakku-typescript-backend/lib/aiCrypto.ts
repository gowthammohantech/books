import crypto from 'crypto';

/**
 * AES-256-GCM helpers for at-rest encryption of user-provided AI provider
 * API keys. The encryption key is loaded from `AI_ENCRYPTION_KEY` (32-byte
 * hex). When that env var is absent we fall back to a SHA-256 hash of
 * `JWT_SECRET` so dev environments work without extra setup — but we warn
 * loudly because rotating JWT_SECRET would invalidate stored keys.
 *
 * Envelope format (base64): IV (12 bytes) || AUTH_TAG (16 bytes) || CIPHERTEXT
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const ALGO = 'aes-256-gcm';

let warnedFallback = false;

function loadKey(): Buffer {
  const hex = process.env.AI_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  const jwt = process.env.JWT_SECRET;
  if (!jwt) {
    throw new Error('aiCrypto: AI_ENCRYPTION_KEY and JWT_SECRET both unset; cannot encrypt');
  }
  if (!warnedFallback) {
    console.warn(
      '[aiCrypto] AI_ENCRYPTION_KEY not set or not 32-byte hex; deriving key from JWT_SECRET. ' +
        'Set AI_ENCRYPTION_KEY=$(openssl rand -hex 32) in production to keep encrypted keys ' +
        'recoverable across JWT_SECRET rotations.',
    );
    warnedFallback = true;
  }
  return crypto.createHash('sha256').update(jwt).digest();
}

export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('aiCrypto.encrypt: plaintext must be a string');
  }
  const key = loadKey();
  if (key.length !== KEY_LEN) {
    throw new Error(`aiCrypto: derived key must be ${KEY_LEN} bytes`);
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decrypt(envelope: string): string {
  if (typeof envelope !== 'string' || envelope.length === 0) {
    throw new Error('aiCrypto.decrypt: envelope must be a non-empty string');
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(envelope, 'base64');
  } catch {
    throw new Error('aiCrypto.decrypt: envelope is not valid base64');
  }
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('aiCrypto.decrypt: envelope too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const key = loadKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Returns a non-secret display hint like `sk-...1234` (last 4 characters).
 * Used in API responses so the user can confirm which key is stored without
 * ever seeing the plaintext again.
 */
export function maskApiKey(key: string): string {
  const tail = (key || '').slice(-4);
  return `sk-...${tail}`;
}
