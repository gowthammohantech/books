/**
 * `isEmailConfigured` — the guard six controllers use before sending an
 * opportunistic email (purchase, purchase order, debit note, quotation,
 * credit note).
 *
 * They previously asked `process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD`,
 * which was wrong three ways. Each of the three is pinned below, because each
 * one silently sent nothing on a real install:
 *
 *  1. docker/.env.example ships SMTP_USER / SMTP_PASS. buildTransport accepts
 *     those aliases; the old guard did not, so an install configured exactly
 *     per the shipped template never sent.
 *  2. SMTP_HOST was not checked, so the guard could pass and the send then
 *     throw EmailNotConfiguredError.
 *  3. Email configured through Settings (Resend / SMTP / Nodemailer rows) left
 *     the env vars empty, so the guard failed on a correctly configured install.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: { emailSettingsFindFirst: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({
  prisma: { emailSettings: { findFirst: mocks.emailSettingsFindFirst } },
}));

// decryptSecret would otherwise need a real key to read the stored password.
vi.mock('../lib/emailSecret', () => ({ decryptSecret: (v: string | null) => v ?? '' }));

import { isEmailConfigured, clearMailerCache } from '../utils/mailer';

const SMTP_VARS = [
  'SMTP_HOST',
  'SMTP_EMAIL',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_PASS',
  'SMTP_PORT',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  clearMailerCache(); // the mailer caches settings for 30s
  for (const k of SMTP_VARS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  mocks.emailSettingsFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  for (const k of SMTP_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  clearMailerCache();
});

describe('isEmailConfigured', () => {
  it('is false when nothing at all is configured', async () => {
    await expect(isEmailConfigured()).resolves.toBe(false);
  });

  // (1) The shipped .env.example spells them this way.
  it('accepts the SMTP_USER / SMTP_PASS aliases that .env.example ships', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    await expect(isEmailConfigured()).resolves.toBe(true);
  });

  it('accepts the SMTP_EMAIL / SMTP_PASSWORD spelling too', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_EMAIL = 'user@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    await expect(isEmailConfigured()).resolves.toBe(true);
  });

  // (2) The old guard passed here and the send then threw.
  it('is false when credentials are set but SMTP_HOST is missing', async () => {
    process.env.SMTP_EMAIL = 'user@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    await expect(isEmailConfigured()).resolves.toBe(false);
  });

  // (3) The case that broke correctly-configured installs.
  it('is true when email is configured through Settings and no env var is set', async () => {
    mocks.emailSettingsFindFirst.mockResolvedValue({
      smtp_status: true,
      smtpHost: 'smtp.tenant.example',
      smtpPort: 587,
      smtpUsername: 'tenant',
      smtpPassword: 'stored',
      smtpFromName: 'Acme',
      smtpFromEmail: 'billing@acme.example',
      smtpReplyTo: null,
    });
    await expect(isEmailConfigured()).resolves.toBe(true);
  });

  it('is true for a Resend configuration', async () => {
    mocks.emailSettingsFindFirst.mockResolvedValue({
      resend_status: true,
      resendApiKey: 're_stored',
      resendFromName: 'Acme',
      resendFromEmail: 'billing@acme.example',
      resendReplyTo: null,
    });
    await expect(isEmailConfigured()).resolves.toBe(true);
  });

  // A row exists but the provider is switched off — not usable.
  it('is false when a settings row exists with every provider disabled', async () => {
    mocks.emailSettingsFindFirst.mockResolvedValue({
      resend_status: false,
      smtp_status: false,
      node_status: false,
      smtpHost: 'smtp.tenant.example',
    });
    await expect(isEmailConfigured()).resolves.toBe(false);
  });
});
