import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt, maskApiKey } from './aiCrypto';

describe('aiCrypto', () => {
  let originalKey: string | undefined;
  let originalJwt: string | undefined;

  beforeAll(() => {
    originalKey = process.env.AI_ENCRYPTION_KEY;
    originalJwt = process.env.JWT_SECRET;
    // Deterministic 32-byte hex key for tests.
    process.env.AI_ENCRYPTION_KEY = '0'.repeat(64);
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = originalKey;
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
  });

  it('round-trips an arbitrary string', () => {
    const plaintext = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    const envelope = encrypt(plaintext);
    expect(envelope).toBeTypeOf('string');
    expect(envelope).not.toBe(plaintext);
    expect(envelope.length).toBeGreaterThan(0);
    expect(decrypt(envelope)).toBe(plaintext);
  });

  it('produces a different ciphertext for repeated encrypts (random IV)', () => {
    const a = encrypt('hello');
    const b = encrypt('hello');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('hello');
    expect(decrypt(b)).toBe('hello');
  });

  it('throws when ciphertext is tampered with', () => {
    const envelope = encrypt('important-secret');
    // Decode, flip a byte well past the IV+tag region, re-encode.
    const buf = Buffer.from(envelope, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws when envelope is garbage', () => {
    expect(() => decrypt('not-a-real-envelope')).toThrow();
  });

  it('falls back to JWT_SECRET-derived key when AI_ENCRYPTION_KEY is missing', () => {
    const savedKey = process.env.AI_ENCRYPTION_KEY;
    delete process.env.AI_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'fallback-jwt-secret';
    try {
      const envelope = encrypt('payload');
      expect(decrypt(envelope)).toBe('payload');
    } finally {
      process.env.AI_ENCRYPTION_KEY = savedKey;
    }
  });

  it('maskApiKey returns sk-...XXXX format for normal keys', () => {
    expect(maskApiKey('sk-ant-api03-abcdef1234')).toBe('sk-...1234');
    expect(maskApiKey('sk-proj-9876543210xyz')).toBe('sk-...0xyz');
  });

  it('maskApiKey handles short keys gracefully', () => {
    expect(maskApiKey('ab')).toBe('sk-...ab');
    expect(maskApiKey('')).toBe('sk-...');
  });
});
