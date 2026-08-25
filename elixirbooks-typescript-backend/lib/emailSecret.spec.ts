import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted } from './emailSecret';

describe('emailSecret', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  });

  it('round-trips a secret through encrypt/decrypt', () => {
    const plain = 'imic moje iovx fyny';
    const enc = encryptSecret(plain);
    expect(enc.startsWith('enc::')).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('passes through legacy plaintext (no marker) unchanged', () => {
    expect(decryptSecret('legacy-plaintext-password')).toBe('legacy-plaintext-password');
    expect(isEncrypted('legacy-plaintext-password')).toBe(false);
  });

  it('returns empty string for null/empty', () => {
    expect(decryptSecret(null)).toBe('');
    expect(decryptSecret(undefined)).toBe('');
    expect(decryptSecret('')).toBe('');
  });
});
